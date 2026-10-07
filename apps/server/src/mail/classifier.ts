import { isTrustedConfirmationDomain } from "@kickrocks/brokers";
import {
  isOnDomain,
  isSharedMailHost,
  type LlmSettings,
  normalizeRecordUrl,
  parseOutgoingMessageId,
  parseReferences,
  type ReplyClassification,
  withoutSharedHosts,
} from "@kickrocks/shared";
import type { SettingsStore } from "../core/settings.js";
import { askLlm, type LlmFetch } from "./llm.js";
import { CLASS_PRIORITY, matchSignals, requestedFieldsIn, type Signal } from "./reply-rules.js";
import { extractLinks, type MailLink, stripQuoted } from "./reply-text.js";
import { type SenderTrust, senderTrust } from "./sender-auth.js";
import type {
  ClassificationResult,
  ClassifierRequest,
  ClassifyContext,
  InboxMessage,
  ReplyClassifier,
} from "./types.js";

/** Below this the message goes to the language model when one is configured, and to a person when not. */
export const CONFIDENCE_THRESHOLD = 0.6;
/** What a reply can reach when nothing ties it to a request, so it always waits for a person. */
const UNMATCHED_CAP = 0.55;
/**
 * What a reply that would change a request can reach without a DKIM signature that vouches for it,
 * so it always waits for a person. A signature vouches when it is the broker's and, for anything
 * but a confirmation link, also covers a quote of this request.
 */
const UNVERIFIED_CAP = 0.55;
/** The floor the contract gives a confirmation email that matches a waiting form submission. */
const AWAITING_CONFIRMATION_FLOOR = 0.8;
const AMBIGUITY_PENALTY = 0.15;
const MAX_LINKS = 10;
/** Longer replies are read only this far, so a hostile message cannot make the rules slow. */
const MAX_BODY_CHARS = 50_000;
const MAX_PATTERN_LENGTH = 200;

type Correlation = NonNullable<ClassificationResult["correlation"]>;

interface Match {
  request: ClassifierRequest;
  via: Correlation;
}

const OUTGOING_ID_IN_TEXT = /<?kr\.[A-Za-z0-9_-]+\.\d+@[A-Za-z0-9.-]+>?/g;

const CONFIRM_LANGUAGE =
  /\b(confirm|verify|validate|authenti[sc]ate)\b.{0,40}\b(your )?(e-?mail|request|opt[- ]?out|removal|deletion|subscription|unsubscribe|address)\b|\bclick\b.{0,40}\b(link|here|button|below)\b.{0,60}\b(confirm|verify|complete|finali[sz]e|validate)\b|\b(to complete|to finali[sz]e|to proceed with|to activate)\b.{0,40}\b(your )?(request|removal|opt[- ]?out|deletion)\b|\bconfirmation (link|email|required)\b/i;
const LINK_HINT =
  /confirm|verif|validat|opt-?out|optout|remov|delet|unsubscrib|token|activate|approve/i;
const STATIC_ASSET = /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?)(\?|$)/i;
const BOILERPLATE_LINK_TEXT =
  /^(privacy( policy| notice)?|terms( of (service|use))?|help|contact( us)?|about( us)?|home)$/i;

const ACTIVE_STATUSES = new Set([
  "awaiting_reply",
  "needs_verification",
  "sent",
  "follow_up_due",
  "no_response",
]);

function senderHost(message: InboxMessage): string {
  return (message.from.address.split("@").pop() ?? "").toLowerCase();
}

function onDomain(host: string, domain: string): boolean {
  return host !== "" && isOnDomain(`https://${host}/`, domain);
}

/** Where a confirmation link may point: following one is stricter than trusting a sender. */
function linkDomainsOf(request: ClassifierRequest): string[] {
  return [request.targetDomain, ...expectedSendersOf(request)];
}

/** Senders a waiting form named that the target would accept. Whatever was stored is checked again. */
function expectedSendersOf(request: ClassifierRequest): string[] {
  return (request.awaitingConfirmation?.fromDomains ?? []).filter((domain) =>
    isTrustedConfirmationDomain(domain, request.targetDomain, request.replyDomains),
  );
}

/** Every domain a signature may align with to vouch for a reply. */
function domainsOf(request: ClassifierRequest): string[] {
  const own = request.targetDomain.toLowerCase();
  const listed = withoutSharedHosts(request.replyDomains);
  return [
    ...new Set([...(isSharedMailHost(own) ? [own] : []), ...listed, ...expectedSendersOf(request)]),
  ];
}

/**
 * Domains whose mail may be matched to a request on the sender alone. A target that lives on a
 * shared host, such as google.com, gets none for its own domain, since anyone on the host can
 * send as it.
 */
function senderDomainsOf(request: ClassifierRequest): string[] {
  return withoutSharedHosts(linkDomainsOf(request));
}

function fromReplyAddress(message: InboxMessage, request: ClassifierRequest): boolean {
  return request.replyAddresses.includes(message.from.address.trim().toLowerCase());
}

function bareId(id: string): string {
  return id.trim().replace(/^<|>$/g, "");
}

function correlateByMessageId(message: InboxMessage, requests: ClassifierRequest[]): Match | null {
  const headerIds = [message.inReplyTo, ...[...message.references].reverse()].filter(
    (id): id is string => Boolean(id),
  );
  // A bounce report quotes the failed message, so our Message-ID can sit in its text rather than its headers.
  const quotedIds = message.isBounce ? (message.text.match(OUTGOING_ID_IN_TEXT) ?? []) : [];
  for (const id of [...headerIds, ...quotedIds]) {
    const wanted = bareId(id);
    const parsed = parseOutgoingMessageId(id);
    const request = requests.find(
      (candidate) =>
        (parsed !== null && candidate.id === parsed.requestId) ||
        (candidate.outgoingMessageId !== null && bareId(candidate.outgoingMessageId) === wanted),
    );
    if (request) return { request, via: "message_id" };
  }
  return null;
}

function correlateByReference(message: InboxMessage, requests: ClassifierRequest[]): Match | null {
  const byReference = (text: string) => {
    const matched = new Set<ClassifierRequest>();
    for (const reference of parseReferences(text)) {
      const request = requests.find((candidate) => candidate.reference === reference);
      if (request) matched.add(request);
    }
    return Array.from(matched);
  };
  // A subject names the request the sender is answering; the body may also quote older ones.
  const inSubject = byReference(message.subject);
  if (inSubject.length === 1)
    return { request: inSubject[0] as ClassifierRequest, via: "reference" };
  if (inSubject.length > 1) return null;
  const inBody = byReference(message.text);
  return inBody.length === 1 ? { request: inBody[0] as ClassifierRequest, via: "reference" } : null;
}

function compilePattern(source: string | null): RegExp | null {
  if (!source || source.length > MAX_PATTERN_LENGTH) return null;
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}

function hinted(link: MailLink): boolean {
  return LINK_HINT.test(link.url) || LINK_HINT.test(link.text);
}

/** The links of a message that sit on the request's own sites and are worth following, best first. */
function usableLinks(links: MailLink[], request: ClassifierRequest): MailLink[] {
  const domains = linkDomainsOf(request);
  const pattern = compilePattern(request.awaitingConfirmation?.linkTextPattern ?? null);
  const rank = (link: MailLink) =>
    (pattern?.test(link.text.slice(0, 300)) ? 2 : 0) + (hinted(link) ? 1 : 0);
  return links
    .filter((link) => domains.some((domain) => isOnDomain(link.url, domain)))
    .filter((link) => !STATIC_ASSET.test(new URL(link.url).pathname))
    .filter((link) => !BOILERPLATE_LINK_TEXT.test(link.text) || hinted(link))
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, MAX_LINKS);
}

function confirmationSignal(
  text: string,
  links: MailLink[],
  request: ClassifierRequest,
): Signal | null {
  if (links.length === 0) return null;
  const pattern = compilePattern(request.awaitingConfirmation?.linkTextPattern ?? null);
  const textMatches =
    pattern !== null && links.some((link) => pattern.test(link.text.slice(0, 300)));
  const language = CONFIRM_LANGUAGE.test(text);
  if (!language && !textMatches) return null;
  const strong = textMatches || links.some(hinted);
  return {
    classification: "confirmation_link",
    confidence: strong ? 0.9 : 0.8,
    rationale: "The message asks for a confirmation and carries a link on the request's own site",
  };
}

function byWaitingSince(a: ClassifierRequest, b: ClassifierRequest): number {
  return (a.awaitingConfirmation?.since ?? "").localeCompare(b.awaitingConfirmation?.since ?? "");
}

/**
 * A confirmation email after a form submission carries no reference and no In-Reply-To, so it is
 * matched by who sent it: the oldest request still waiting for that sender, unless the message
 * names the record one of them is for.
 */
function matchAwaitingConfirmation(
  message: InboxMessage,
  requests: ClassifierRequest[],
  links: MailLink[],
  text: string,
): { match: Match; signal: Signal } | null {
  const host = senderHost(message);
  const waiting = requests
    .filter(
      (request) =>
        request.awaitingConfirmation !== null &&
        senderDomainsOf(request).some((domain) => onDomain(host, domain)),
    )
    .sort(byWaitingSince);
  if (waiting.length === 0) return null;

  const named = new Set(
    [...links.map((link) => link.url), ...(text.match(/https?:\/\/\S+/g) ?? [])]
      .map(normalizeRecordUrl)
      .filter((value): value is string => value !== null),
  );
  const forRecord = (request: ClassifierRequest) => {
    const record = request.recordUrl ? normalizeRecordUrl(request.recordUrl) : null;
    return record !== null && named.has(record);
  };
  const ordered = [...waiting.filter(forRecord), ...waiting.filter((r) => !forRecord(r))];

  for (const request of ordered) {
    const signal = confirmationSignal(text, usableLinks(links, request), request);
    if (signal) return { match: { request, via: "sender_domain" }, signal };
  }
  return null;
}

function correlateBySender(message: InboxMessage, requests: ClassifierRequest[]): Match | null {
  const host = senderHost(message);
  const candidates = requests.filter(
    (request) =>
      withoutSharedHosts(request.replyDomains).some((domain) => onDomain(host, domain)) ||
      fromReplyAddress(message, request),
  );
  if (candidates.length === 1)
    return { request: candidates[0] as ClassifierRequest, via: "sender_domain" };
  const active = candidates.filter((request) => ACTIVE_STATUSES.has(request.status));
  return active.length === 1
    ? { request: active[0] as ClassifierRequest, via: "sender_domain" }
    : null;
}

function describeCorrelation(via: Correlation | null): string {
  switch (via) {
    case "message_id":
      return "matched by the Message-ID it answers";
    case "reference":
      return "matched by the request reference";
    case "sender_domain":
      return "matched by the sender's domain";
    default:
      return "not matched to any request";
  }
}

/** The classifications that move a request or switch its channel, so they need a signature to be applied. */
const CHANGES_REQUEST = new Set<ReplyClassification>([
  "bounce",
  "confirmation_link",
  "verification_required",
  "completed",
  "no_record",
  "rejected",
  "needs_form",
]);

interface Capped {
  confidence: number;
  /** Why a person must look, set only when the missing trust is what held the confidence back. */
  reason: string | null;
}

/**
 * What a classification may reach given how firmly the reply is tied to a request. A confirmation
 * link needs only the broker's signature, because following a genuine link on the broker's own
 * domain can only confirm a removal; every other change needs the signature to quote the request.
 */
async function capFor(
  classification: ReplyClassification,
  via: Correlation | null,
  confidence: number,
  trust: () => Promise<SenderTrust>,
  ownSiteTrust: () => Promise<SenderTrust>,
): Promise<Capped> {
  if (via === null) {
    return {
      confidence: classification === "unrelated" ? confidence : Math.min(confidence, UNMATCHED_CAP),
      reason: null,
    };
  }
  // Verifying costs DNS lookups, so it is skipped when the cap already decides.
  if (!CHANGES_REQUEST.has(classification) || confidence <= UNVERIFIED_CAP) {
    return { confidence, reason: null };
  }
  const found = await trust();
  if (found === "bound") return { confidence, reason: null };
  // The exception is narrower than the trust above: only the target's own site, or the sender a
  // waiting form named, may have a link followed on a signature alone. A target on a shared host
  // never qualifies, because its site is no one's own.
  if (
    found === "signed" &&
    classification === "confirmation_link" &&
    (await ownSiteTrust()) !== "unsigned"
  ) {
    return { confidence, reason: null };
  }
  return {
    confidence: UNVERIFIED_CAP,
    reason: found === "unsigned" ? "not signed by the broker" : "does not quote this request",
  };
}

/** Remembers the answer, because the check may be wanted by both the rules and the model fallback. */
function once<T>(work: () => Promise<T>): () => Promise<T> {
  let answer: Promise<T> | undefined;
  return () => {
    answer ??= work();
    return answer;
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface ReplyClassifierDeps {
  settings: Pick<SettingsStore, "get">;
  fetch?: LlmFetch;
  llmTimeoutMs?: number;
}

function configuredLlm(settings: Pick<SettingsStore, "get">): LlmSettings | null {
  try {
    return settings.get("llm");
  } catch {
    return null;
  }
}

export function createReplyClassifier(deps: ReplyClassifierDeps): ReplyClassifier {
  return {
    async classify(message: InboxMessage, context: ClassifyContext): Promise<ClassificationResult> {
      const body = stripQuoted(message.text).slice(0, MAX_BODY_CHARS);
      const text = `${message.subject}\n${body}`;
      const allLinks = extractLinks(message.html, message.text);
      const requests = context.requests;

      let match =
        correlateByMessageId(message, requests) ?? correlateByReference(message, requests);
      const signals = matchSignals({ message, body });

      if (match) {
        const signal = confirmationSignal(
          text,
          usableLinks(allLinks, match.request),
          match.request,
        );
        if (signal) signals.push(signal);
      } else {
        const awaiting = matchAwaitingConfirmation(message, requests, allLinks, text);
        if (awaiting) {
          match = awaiting.match;
          signals.push({
            ...awaiting.signal,
            confidence: Math.max(awaiting.signal.confidence, AWAITING_CONFIRMATION_FLOOR),
          });
        } else {
          match = correlateBySender(message, requests);
          if (match) {
            const signal = confirmationSignal(
              text,
              usableLinks(allLinks, match.request),
              match.request,
            );
            if (signal) signals.push(signal);
          }
        }
      }

      const links = match ? usableLinks(allLinks, match.request).map((link) => link.url) : [];
      const via = match?.via ?? null;
      const matched = match;
      const trust = once<SenderTrust>(async () =>
        matched === null
          ? "unsigned"
          : senderTrust(message, matched.request, domainsOf(matched.request)),
      );
      const ownSiteTrust = once<SenderTrust>(async () =>
        matched === null || isSharedMailHost(matched.request.targetDomain)
          ? "unsigned"
          : senderTrust(message, matched.request, linkDomainsOf(matched.request), false),
      );
      const requestId = match?.request.id ?? null;

      signals.sort(
        (a, b) =>
          b.confidence - a.confidence ||
          CLASS_PRIORITY.indexOf(a.classification) - CLASS_PRIORITY.indexOf(b.classification),
      );
      const top = signals[0];

      let result: ClassificationResult;
      if (top) {
        const rival = signals.some(
          (signal) =>
            signal.classification !== top.classification &&
            signal.classification !== "auto_ack" &&
            signal.confidence >= CONFIDENCE_THRESHOLD,
        );
        const confidence = rival
          ? Math.max(0.3, top.confidence - AMBIGUITY_PENALTY)
          : top.confidence;
        // A confirmation that matched a waiting form keeps the contract's floor even with a rival signal.
        const floored =
          top.classification === "confirmation_link" &&
          via === "sender_domain" &&
          match?.request.awaitingConfirmation
            ? Math.max(confidence, AWAITING_CONFIRMATION_FLOOR)
            : confidence;
        const capped = await capFor(top.classification, via, floored, trust, ownSiteTrust);
        result = {
          requestId,
          correlation: via,
          classification: top.classification,
          confidence: round(capped.confidence),
          rationale: `${top.rationale}${rival ? ", though other wording points elsewhere" : ""}; ${describeCorrelation(via)}${capped.reason ? `; ${capped.reason}` : ""}`,
          links,
          requestedFields:
            top.classification === "verification_required" ? requestedFieldsIn(body) : [],
        };
      } else if (requestId !== null) {
        result = {
          requestId,
          correlation: via,
          classification: "unknown",
          confidence: 0.2,
          rationale: `A reply with no wording the rules know; ${describeCorrelation(via)}`,
          links,
          requestedFields: [],
        };
      } else {
        result = {
          requestId: null,
          correlation: null,
          classification: "unrelated",
          confidence: 0.7,
          rationale: "Mail that does not belong to any request",
          links: [],
          requestedFields: [],
        };
      }

      if (result.confidence >= CONFIDENCE_THRESHOLD) return result;
      return refineWithLlm(deps, message, body, result, via, trust, ownSiteTrust);
    },
  };
}

async function refineWithLlm(
  deps: ReplyClassifierDeps,
  message: InboxMessage,
  body: string,
  current: ClassificationResult,
  via: Correlation | null,
  trust: () => Promise<SenderTrust>,
  ownSiteTrust: () => Promise<SenderTrust>,
): Promise<ClassificationResult> {
  const llm = configuredLlm(deps.settings);
  if (!llm) return current;
  const answer = await askLlm(
    llm,
    {
      subject: message.subject,
      body,
      hint: { classification: current.classification, confidence: current.confidence },
    },
    deps.fetch,
    deps.llmTimeoutMs,
  );
  if (!answer) return current;

  // The model may name a confirmation, but it cannot supply the link: only links on the request's
  // own sites were ever collected, so with none the claim has nothing to act on.
  const unsupported = answer.classification === "confirmation_link" && current.links.length === 0;
  const classification: ReplyClassification = unsupported ? "unknown" : answer.classification;
  const capped = await capFor(
    classification,
    via,
    unsupported ? 0.3 : Math.min(answer.confidence, 0.9),
    trust,
    ownSiteTrust,
  );
  const confidence = round(capped.confidence);
  if (confidence <= current.confidence) return current;
  return {
    ...current,
    classification,
    confidence,
    rationale: `Model: ${answer.rationale || "no reason given"}${capped.reason ? `; ${capped.reason}` : ""}`,
    requestedFields: classification === "verification_required" ? answer.requested_fields : [],
  };
}
