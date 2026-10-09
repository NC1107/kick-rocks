import {
  type CompanyMail,
  type IgnoreRule,
  type MessageAdmission,
  parseOutgoingMessageId,
  parseReferences,
  withoutSharedHosts,
} from "@kickrocks/shared";
import { matchAwaitingConfirmation, onDomain, senderDomainsOf } from "./classifier.js";
import { looksLikeDeliveryReport } from "./parse.js";
import { extractLinks, stripQuoted } from "./reply-text.js";
import type { ClassifierRequest, InboxMessage, MessageHeaders } from "./types.js";

/** A sender the person asked to always take in for one target. */
export interface PersonSender {
  targetId: string;
  kind: "domain" | "address";
  value: string;
}

export interface IntakeInput {
  /** The classifier's context: open requests, and finished ones inside the correlation window. */
  requests: ClassifierRequest[];
  /** The alias replies are sent to, only once it was proven to reach the mailbox. */
  verifiedAlias: string | null;
  companyMail: CompanyMail;
  personSenders: PersonSender[];
  now: Date;
}

export interface IntakeContext {
  /** Every request in the window. Used only to bind a message by thread or reference. */
  window: ClassifierRequest[];
  /** Requests still expecting an answer. Used for sender and name rules. */
  open: ClassifierRequest[];
  verifiedAlias: string | null;
  companyMail: CompanyMail;
  personSenders: PersonSender[];
  now: Date;
}

export function intakeContext(input: IntakeInput): IntakeContext {
  return {
    window: input.requests,
    open: input.requests.filter((request) => request.open),
    verifiedAlias: input.verifiedAlias?.toLowerCase() ?? null,
    companyMail: input.companyMail,
    personSenders: input.personSenders,
    now: input.now,
  };
}

/** Why a message has to be read before it can be decided. */
export type BodyReason =
  | "delivery_report"
  | "awaiting"
  | "alias_bulk"
  | "bulk_target"
  | "company"
  /** Nothing in the headers decides; only a body that names a request makes it matter. */
  | "unknown"
  /** Bulk mail from a stranger; only one of our references in its body makes it matter. */
  | "bulk_other";

export type HeaderVerdict =
  | { verdict: "admit"; by: MessageAdmission }
  | { verdict: "needs_body"; reasons: BodyReason[] }
  | { verdict: "ignore" };

export type BodyVerdict =
  | { verdict: "admit"; by: MessageAdmission }
  /** `rule` is null for mail Kick Rocks sent itself, which is never passed over, only not a reply. */
  | { verdict: "ignore"; rule: IgnoreRule | null };

const admit = (by: MessageAdmission): { verdict: "admit"; by: MessageAdmission } => ({
  verdict: "admit",
  by,
});
const needsBody = (...reasons: BodyReason[]): HeaderVerdict => ({ verdict: "needs_body", reasons });
const IGNORE = { verdict: "ignore" } as const;
const ignoredBy = (rule: IgnoreRule): BodyVerdict => ({ verdict: "ignore", rule });

const BODY_CHARS_READ = 3_000;
const BOUNCE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MARKETING_LABELS = new Set([
  "e",
  "em",
  "email",
  "mail",
  "mailer",
  "news",
  "info",
  "marketing",
  "promo",
  "offers",
]);
const TICKET_DESK_SUFFIXES = ["zendesk.com", "freshdesk.com", "helpscout.net", "zohodesk.com"];
const PRIVACY_MAILBOX =
  /^(privacy|dsar|dpo|optout|opt-out|gdpr|ccpa|dataprotection)$|^privacy[-_.]/i;

const REQUEST_PHRASE =
  /\b(opt[- ]?out|removal|remove request|deletion|privacy request|data request|your request to (remove|delete|opt[- ]?out)|ccpa|cpra|gdpr|dsar|data subject|right to (delete|know|erasure))\b/i;
const PRIVACY_TOPIC = new RegExp(
  `${REQUEST_PHRASE.source}|\\b(remove|delete|erase|suppress)\\w* (your|my|the)? ?(data|information|listing|profile|records?|personal)\\b|\\b(listing|profile|records?|information|data)\\b[^.\\n]{0,40}\\b(removed|deleted|erased|suppressed)\\b|\\bpersonal (data|information)\\b|\\byour data\\b|\\bno (matching )?records?\\b|\\bdo not sell\\b|\\bprivacy (team|office|rights)\\b`,
  "i",
);

const bareId = (id: string) => id.trim().replace(/^<|>$/g, "");

/** A header's value split into the addresses it holds. */
export function addressesIn(value: string | undefined): string[] {
  return (value?.toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []).map(
    (address) => address,
  );
}

/** The headers of a fully parsed message, so one gate decides both a scan and a download. */
export function headersOf(message: InboxMessage): MessageHeaders {
  const recipients = new Set([
    ...message.to,
    ...["cc", "delivered-to", "x-original-to"].flatMap((name) =>
      addressesIn(message.headers[name]),
    ),
  ]);
  return {
    uid: message.uid,
    messageId: message.messageId,
    inReplyTo: message.inReplyTo,
    references: message.references,
    from: message.from,
    recipients: [...recipients],
    subject: message.subject,
    date: message.date,
    isDeliveryReport:
      message.isBounce || looksLikeDeliveryReport(message.headers, message.from.address),
    headers: message.headers,
  };
}

function isBulk(h: MessageHeaders, ctx: IntakeContext): boolean {
  if ("list-id" in h.headers || "list-unsubscribe" in h.headers) return true;
  if (/^(bulk|list|junk)$/i.test((h.headers.precedence ?? "").trim())) return true;
  return ctx.open.some((request) => marketingSubdomainOf(host(h), request));
}

const host = (h: MessageHeaders) => (h.from.address.split("@").pop() ?? "").toLowerCase();

function marketingSubdomainOf(sender: string, request: ClassifierRequest): boolean {
  const own = targetDomains(request);
  return own.some(
    (domain) =>
      sender.endsWith(`.${domain}`) &&
      MARKETING_LABELS.has(sender.slice(0, -domain.length - 1).split(".")[0] ?? ""),
  );
}

function targetDomains(request: ClassifierRequest): string[] {
  return withoutSharedHosts([
    request.targetDomain,
    ...request.curatedReplyDomains,
    ...request.replyDomains,
  ]).map((domain) => domain.toLowerCase());
}

function ticketDeskOf(sender: string, request: ClassifierRequest): boolean {
  return TICKET_DESK_SUFFIXES.some(
    (suffix) =>
      sender.endsWith(`.${suffix}`) && sender.split(".")[0] === request.targetId.toLowerCase(),
  );
}

function personSendersFor(h: MessageHeaders, ctx: IntakeContext): PersonSender[] {
  const address = h.from.address.toLowerCase();
  const sender = host(h);
  return ctx.personSenders.filter((entry) =>
    entry.kind === "address" ? entry.value === address : onDomain(sender, entry.value),
  );
}

const personSenderOf = (h: MessageHeaders, ctx: IntakeContext) =>
  personSendersFor(h, ctx).length > 0;

function isTargetSender(h: MessageHeaders, request: ClassifierRequest): boolean {
  const sender = host(h);
  return (
    targetDomains(request).some((domain) => onDomain(sender, domain)) ||
    request.replyAddresses.includes(h.from.address.toLowerCase()) ||
    ticketDeskOf(sender, request)
  );
}

function bindsByThread(h: MessageHeaders, ctx: IntakeContext): boolean {
  const ids = [h.inReplyTo, ...h.references].filter((id): id is string => Boolean(id));
  return ids.some((id) => {
    const parsed = parseOutgoingMessageId(id);
    return ctx.window.some(
      (request) =>
        (parsed !== null && parsed.requestId === request.id) ||
        (request.outgoingMessageId !== null && bareId(request.outgoingMessageId) === bareId(id)),
    );
  });
}

function namesReference(text: string, ctx: IntakeContext): boolean {
  const own = new Set(ctx.window.map((request) => request.reference as string));
  return parseReferences(text).some((reference) => own.has(reference));
}

function expectsConfirmationFrom(h: MessageHeaders, ctx: IntakeContext): boolean {
  const sender = host(h);
  return ctx.window.some(
    (request) =>
      request.awaitingConfirmation !== null &&
      [...senderDomainsOf(request), ...request.curatedReplyDomains].some((domain) =>
        onDomain(sender, domain),
      ),
  );
}

function exactlyPrivacyChannel(h: MessageHeaders, request: ClassifierRequest): boolean {
  const address = h.from.address.toLowerCase();
  const local = address.split("@")[0] ?? "";
  return (
    address === (request.contactAddress ?? "").toLowerCase() ||
    request.replyAddresses.includes(address) ||
    request.curatedReplyDomains.some((domain) => onDomain(host(h), domain)) ||
    PRIVACY_MAILBOX.test(local)
  );
}

/**
 * Decides from the headers alone whether a message concerns a request. Rules run in order and the
 * first that decides wins. Most mail is settled here, so most mail is never downloaded.
 */
export function triageHeaders(
  h: MessageHeaders,
  ctx: IntakeContext,
  skip: ReadonlySet<BodyReason> = new Set(),
): HeaderVerdict {
  if (h.messageId && parseOutgoingMessageId(h.messageId)) return IGNORE;
  if (bindsByThread(h, ctx)) return admit("thread");
  if (namesReference(h.subject, ctx)) return admit("reference");
  if (!skip.has("delivery_report") && h.isDeliveryReport) return needsBody("delivery_report");
  if (!skip.has("awaiting") && expectsConfirmationFrom(h, ctx)) return needsBody("awaiting");
  if (personSenderOf(h, ctx)) return admit("target_sender");

  const bulk = isBulk(h, ctx);
  if (ctx.verifiedAlias && h.recipients.includes(ctx.verifiedAlias)) {
    return bulk ? needsBody("alias_bulk") : admit("alias");
  }

  const targets = ctx.open.filter((request) => isTargetSender(h, request));
  if (targets.length > 0) {
    if (bulk) return needsBody("bulk_target");
    if (targets.some((request) => request.targetKind === "broker")) return admit("target_sender");
    if (ctx.companyMail === "all" || targets.some((request) => exactlyPrivacyChannel(h, request))) {
      return admit("target_sender");
    }
    return needsBody("company");
  }
  return bulk ? needsBody("bulk_other") : needsBody("unknown");
}

/** The subject and the start of what the sender wrote, without the part that quotes our request. */
function readableText(message: InboxMessage): string {
  return `${message.subject}\n${stripQuoted(message.text).slice(0, BODY_CHARS_READ)}`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function namesOpenTarget(text: string, ctx: IntakeContext): boolean {
  const lower = text.toLowerCase();
  return ctx.open.some(
    (request) =>
      new RegExp(`\\b${escapeRegex(request.targetName)}\\b`, "i").test(text) ||
      lower.includes(request.targetDomain.toLowerCase()),
  );
}

function reportsOurMail(message: InboxMessage, ctx: IntakeContext): boolean {
  const ids = [
    ...message.originalMessageIds,
    ...(message.text.match(/<?kr\.[A-Za-z0-9_-]+\.\d+@[A-Za-z0-9.-]+>?/g) ?? []),
  ];
  if (
    ids.some((id) => {
      const parsed = parseOutgoingMessageId(id);
      return (
        (parsed !== null && ctx.window.some((request) => request.id === parsed.requestId)) ||
        ctx.window.some(
          (request) =>
            request.outgoingMessageId !== null && bareId(request.outgoingMessageId) === bareId(id),
        )
      );
    })
  ) {
    return true;
  }
  const failed = new Set([
    ...addressesIn(message.headers["x-failed-recipients"]),
    ...[
      ...message.text.matchAll(/(?:final|original)-recipient:\s*(?:rfc822;)?\s*<?([^\s>;]+)/gi),
    ].map((match) => (match[1] as string).toLowerCase()),
  ]);
  return ctx.open.some(
    (request) =>
      request.channel === "email" &&
      request.contactAddress !== null &&
      failed.has(request.contactAddress.toLowerCase()) &&
      request.sentAt !== null &&
      ctx.now.getTime() - Date.parse(request.sentAt) <= BOUNCE_WINDOW_MS,
  );
}

/**
 * Decides a downloaded message that the headers could not settle. The headers are triaged again
 * so the body is read only for the reasons they gave.
 */
export function triageBody(message: InboxMessage, ctx: IntakeContext): BodyVerdict {
  if (namesReference(`${message.subject}\n${message.text}`, ctx)) return admit("reference");
  const h = headersOf(message);
  const skip = new Set<BodyReason>();
  for (;;) {
    const verdict = triageHeaders(h, ctx, skip);
    if (verdict.verdict === "admit") return verdict;
    if (verdict.verdict === "ignore") return { verdict: "ignore", rule: null };
    const [reason] = verdict.reasons as [BodyReason];
    const text = readableText(message);
    switch (reason) {
      case "delivery_report":
        return reportsOurMail(message, ctx) ? admit("bounce") : ignoredBy("bounce_not_ours");
      case "awaiting": {
        const links = extractLinks(message.html, message.text);
        if (matchAwaitingConfirmation(message, ctx.window, links, text)) {
          return admit("awaiting_confirmation");
        }
        skip.add("awaiting");
        continue;
      }
      case "alias_bulk":
        return REQUEST_PHRASE.test(text) ? admit("alias") : ignoredBy("bulk_no_privacy");
      case "bulk_target":
        return bulkTargetPhrase(h, ctx).test(text)
          ? admit("target_sender")
          : ignoredBy("bulk_no_privacy");
      case "company":
        return PRIVACY_TOPIC.test(text) ? admit("target_sender") : ignoredBy("company_not_privacy");
      case "unknown":
        return namesOpenTarget(text, ctx) && PRIVACY_TOPIC.test(text)
          ? admit("named_target")
          : ignoredBy(unmatchedRule("not_named", h, ctx));
      case "bulk_other":
        return ignoredBy(unmatchedRule("stranger_bulk", h, ctx));
    }
  }
}

/**
 * Mail from a sender whose request is finished is passed over because nobody is waiting on it, not
 * because the sender is a stranger, and a person reading why should be told so.
 */
export function unmatchedRule(
  rule: Extract<IgnoreRule, "not_named" | "stranger_bulk" | "no_wording_found">,
  h: MessageHeaders,
  ctx: IntakeContext,
): IgnoreRule {
  return isFromAnyTarget(h, ctx) ? "finished_request" : rule;
}

/** Why a message whose body a server-side search found nothing in was never downloaded. */
export function unreadRule(h: MessageHeaders, reason: BodyReason, ctx: IntakeContext): IgnoreRule {
  switch (reason) {
    case "company":
      return "company_not_privacy";
    case "bulk_target":
    case "alias_bulk":
      return "bulk_no_privacy";
    case "bulk_other":
      return unmatchedRule("stranger_bulk", h, ctx);
    case "unknown":
      return unmatchedRule("not_named", h, ctx);
    default:
      return unmatchedRule("no_wording_found", h, ctx);
  }
}

/**
 * Whether a message the gate passed over could still be a reply. The rules before the gate kept
 * every message, so what is worth showing a person is only what ties to a request: its sender, a
 * company it names, or privacy wording. Judged on the headers alone when the body was not read.
 */
export function couldBeAReply(
  h: MessageHeaders,
  message: InboxMessage | null,
  ctx: IntakeContext,
): boolean {
  const text = message ? readableText(message) : h.subject;
  return isFromAnyTarget(h, ctx) || namesAnyTarget(text, ctx) || PRIVACY_TOPIC.test(text);
}

/**
 * Whole words and phrases that every text the wording rules match must contain, so a server-side
 * search that finds none of them proves the rules would find nothing. Servers that index words
 * (Gmail, iCloud) never match a fragment, so each form a rule's stem can take is spelled out.
 * Looser than the rules on purpose.
 */
const REQUEST_TERMS = [
  "opt-out",
  "opt out",
  "optout",
  "removal",
  "remove request",
  "deletion",
  "privacy request",
  "data request",
  "your request to",
  "ccpa",
  "cpra",
  "gdpr",
  "dsar",
  "data subject",
  "right to",
];
const PRIVACY_TERMS = [
  ...REQUEST_TERMS,
  ...["remove", "delete", "erase", "suppress"].flatMap((verb) => verbForms(verb)),
  "erasure",
  "suppression",
  "personal",
  "your data",
  "record",
  "records",
  "do not sell",
  "privacy team",
  "privacy office",
  "privacy rights",
];

function verbForms(verb: string): string[] {
  const stem = verb.endsWith("e") ? verb.slice(0, -1) : verb;
  return [verb, `${verb}s`, `${stem}ed`, `${stem}ing`];
}

/** The references of every request in the window, which are whole words no server has to split. */
function referenceTerms(ctx: IntakeContext): string[] {
  return [...new Set(ctx.window.map((request) => request.reference))];
}

/**
 * What a server-side search should look for in bodies to find the messages an open target's name
 * or domain, or one of our references, appears in.
 */
export function bodySearchTerms(ctx: IntakeContext): string[] {
  const terms = new Set<string>(referenceTerms(ctx));
  for (const request of ctx.open) {
    terms.add(request.targetName);
    terms.add(request.targetDomain.toLowerCase());
  }
  return [...terms].filter((term) => term.trim() !== "");
}

/**
 * What a search should look for to find a body that could be a reply: a target's name or domain,
 * one of our references, or privacy wording. Looser than the rules on purpose.
 */
export function replySearchTerms(ctx: IntakeContext): string[] {
  return [...new Set([...bodySearchTerms(ctx), ...PRIVACY_TERMS])];
}

/**
 * Bulk mail from a broker is judged on everything a broker's answer can say, since a "no records"
 * or "listing removed" notice often goes out through a mailing service. A company's bulk mail
 * needs the narrower request wording, since it sends plenty of marketing.
 */
function bulkTargetPhrase(h: MessageHeaders, ctx: IntakeContext): RegExp {
  const fromBroker = ctx.open.some(
    (request) => request.targetKind === "broker" && isTargetSender(h, request),
  );
  return fromBroker ? PRIVACY_TOPIC : REQUEST_PHRASE;
}

export type SearchScope = "references" | "request" | "privacy" | "named";

export type ReadPlan =
  /** Read the body: the headers already show something that makes it worth it. */
  | { read: "now" }
  /** Read the body only if the server finds one of the terms in it. */
  | { read: "if_found"; scope: SearchScope; terms: string[] };

/** How to settle a message the headers could not, with as little download as the evidence allows. */
export function readPlanFor(
  h: MessageHeaders,
  verdict: Extract<HeaderVerdict, { verdict: "needs_body" }>,
  ctx: IntakeContext,
): ReadPlan {
  const [reason] = verdict.reasons as [BodyReason];
  switch (reason) {
    case "bulk_other":
      return { read: "if_found", scope: "references", terms: referenceTerms(ctx) };
    case "alias_bulk":
      return REQUEST_PHRASE.test(h.subject)
        ? { read: "now" }
        : { read: "if_found", scope: "request", terms: [...referenceTerms(ctx), ...REQUEST_TERMS] };
    case "bulk_target": {
      const phrase = bulkTargetPhrase(h, ctx);
      if (phrase.test(h.subject)) return { read: "now" };
      return phrase === PRIVACY_TOPIC
        ? { read: "if_found", scope: "privacy", terms: [...referenceTerms(ctx), ...PRIVACY_TERMS] }
        : { read: "if_found", scope: "request", terms: [...referenceTerms(ctx), ...REQUEST_TERMS] };
    }
    case "company":
      return PRIVACY_TOPIC.test(h.subject)
        ? { read: "now" }
        : {
            read: "if_found",
            scope: "privacy",
            terms: [...referenceTerms(ctx), ...PRIVACY_TERMS],
          };
    case "unknown":
      return namesOpenTarget(h.subject, ctx)
        ? { read: "now" }
        : { read: "if_found", scope: "named", terms: bodySearchTerms(ctx) };
    default:
      return { read: "now" };
  }
}

/** Whether a message was admitted on its sender or its wording alone, without a link to a request. */
export function isSoftAdmission(by: MessageAdmission): boolean {
  return by === "target_sender" || by === "named_target";
}

/**
 * The targets a message was let in for by its sender alone: the person's own sender rules and the
 * target-sender rules, so the classifier can bind it to a request the wording does not name.
 */
export function senderTargetIds(h: MessageHeaders, ctx: IntakeContext): string[] {
  return [
    ...new Set([
      ...personSendersFor(h, ctx).map((entry) => entry.targetId),
      ...ctx.open
        .filter((request) => isTargetSender(h, request))
        .map((request) => request.targetId),
    ]),
  ];
}

/**
 * Whether mail let in on soft evidence is positively not about a request: it is bulk mail and
 * says nothing about privacy. Anything less certain is kept for a person to look at.
 */
export function isBulkWithoutPrivacyWording(message: InboxMessage, ctx: IntakeContext): boolean {
  return isBulk(headersOf(message), ctx) && !PRIVACY_TOPIC.test(readableText(message));
}

/** Whether the sender belongs to a target the person has any request with, open or finished. */
export function isFromAnyTarget(h: MessageHeaders, ctx: IntakeContext): boolean {
  return ctx.window.some((request) => isTargetSender(h, request)) || personSenderOf(h, ctx);
}

/** Whether a text names any target the person has a request with, open or finished. */
export function namesAnyTarget(text: string, ctx: IntakeContext): boolean {
  const lower = text.toLowerCase();
  return ctx.window.some(
    (request) =>
      new RegExp(`\\b${escapeRegex(request.targetName)}\\b`, "i").test(text) ||
      lower.includes(request.targetDomain.toLowerCase()),
  );
}

/** Whether a text holds one of our references or Message-IDs, which bind it to a request. */
export function bindsToRequest(text: string, ctx: IntakeContext): boolean {
  return (
    namesReference(text, ctx) ||
    (text.match(/<?kr\.[A-Za-z0-9_-]+\.\d+@[A-Za-z0-9.-]+>?/g) ?? []).some((id) => {
      const parsed = parseOutgoingMessageId(id);
      return parsed !== null && ctx.window.some((request) => request.id === parsed.requestId);
    })
  );
}
