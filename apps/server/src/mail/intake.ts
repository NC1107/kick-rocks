import {
  type CompanyMail,
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

export type BodyVerdict = { verdict: "admit"; by: MessageAdmission } | { verdict: "ignore" };

const admit = (by: MessageAdmission): { verdict: "admit"; by: MessageAdmission } => ({
  verdict: "admit",
  by,
});
const needsBody = (...reasons: BodyReason[]): HeaderVerdict => ({ verdict: "needs_body", reasons });
const IGNORE = { verdict: "ignore" } as const;

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
  `${REQUEST_PHRASE.source}|\\b(remove|delete|erase|suppress)\\w* (your|my|the)? ?(data|information|listing|profile|record|personal)\\b|\\bpersonal (data|information)\\b|\\byour data\\b|\\bno (matching )?records?\\b|\\bdo not sell\\b|\\bprivacy (team|office|rights)\\b`,
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

function personSenderOf(h: MessageHeaders, ctx: IntakeContext): boolean {
  const address = h.from.address.toLowerCase();
  const sender = host(h);
  return ctx.personSenders.some((entry) =>
    entry.kind === "address" ? entry.value === address : onDomain(sender, entry.value),
  );
}

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
    if (verdict.verdict !== "needs_body") return verdict;
    const [reason] = verdict.reasons as [BodyReason];
    const text = readableText(message);
    switch (reason) {
      case "delivery_report":
        return reportsOurMail(message, ctx) ? admit("bounce") : IGNORE;
      case "awaiting": {
        const links = extractLinks(message.html, message.text);
        if (matchAwaitingConfirmation(message, ctx.window, links, text)) {
          return admit("awaiting_confirmation");
        }
        skip.add("awaiting");
        continue;
      }
      case "alias_bulk":
        return REQUEST_PHRASE.test(text) ? admit("alias") : IGNORE;
      case "bulk_target":
        return REQUEST_PHRASE.test(text) ? admit("target_sender") : IGNORE;
      case "company":
        return PRIVACY_TOPIC.test(text) ? admit("target_sender") : IGNORE;
      case "unknown":
        return namesOpenTarget(text, ctx) && PRIVACY_TOPIC.test(text)
          ? admit("named_target")
          : IGNORE;
      case "bulk_other":
        return IGNORE;
    }
  }
}

/**
 * Substrings that every text the wording rules match must contain, so a server-side search that
 * finds none of them proves the rules would find nothing. Looser than the rules on purpose.
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
  "remov",
  "delet",
  "erase",
  "suppress",
  "personal",
  "your data",
  "record",
  "do not sell",
  "privacy team",
  "privacy office",
  "privacy rights",
];
const REFERENCE_TERM = "KR-";

/**
 * What a server-side search should look for in bodies to find the messages an open target's name
 * or domain, or our reference marker, appears in.
 */
export function bodySearchTerms(ctx: IntakeContext): string[] {
  const terms = new Set<string>([REFERENCE_TERM]);
  for (const request of ctx.open) {
    terms.add(request.targetName);
    terms.add(request.targetDomain.toLowerCase());
  }
  return [...terms].filter((term) => term.trim() !== "");
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
      return { read: "if_found", scope: "references", terms: [REFERENCE_TERM] };
    case "alias_bulk":
    case "bulk_target":
      return REQUEST_PHRASE.test(h.subject)
        ? { read: "now" }
        : { read: "if_found", scope: "request", terms: [REFERENCE_TERM, ...REQUEST_TERMS] };
    case "company":
      return PRIVACY_TOPIC.test(h.subject)
        ? { read: "now" }
        : { read: "if_found", scope: "privacy", terms: [REFERENCE_TERM, ...PRIVACY_TERMS] };
    case "unknown":
      return namesOpenTarget(h.subject, ctx)
        ? { read: "now" }
        : { read: "if_found", scope: "named", terms: bodySearchTerms(ctx) };
    default:
      return { read: "now" };
  }
}

/** Whether a message that was admitted only on soft evidence may be dropped when it matches nothing. */
export function isSoftAdmission(by: MessageAdmission): boolean {
  return by === "target_sender" || by === "named_target";
}

/** Whether the sender belongs to a target the person has an open request with. */
export function isFromOpenTarget(h: MessageHeaders, ctx: IntakeContext): boolean {
  return ctx.open.some((request) => isTargetSender(h, request)) || personSenderOf(h, ctx);
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
