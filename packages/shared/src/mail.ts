import { z } from "zod";
import { ProfileField } from "./identities.js";
import { WebUrl } from "./url.js";

/**
 * What a message sent for a request is for. A follow-up is a reminder after the first one went
 * unanswered, and a verification reply sends identifiers a broker asked for and the person approved.
 */
export const EmailKind = z.enum(["initial", "follow_up", "verification_reply"]);
export type EmailKind = z.infer<typeof EmailKind>;

export const ReplyClassification = z.enum([
  "bounce",
  "auto_ack",
  "confirmation_link",
  "verification_required",
  "completed",
  "no_record",
  "rejected",
  "needs_form",
  "unrelated",
  "unknown",
]);
export type ReplyClassification = z.infer<typeof ReplyClassification>;

/** Why the intake gate took a message in. Mail stored before the gate existed has none. */
export const MessageAdmission = z.enum([
  "thread",
  "reference",
  "alias",
  "bounce",
  "awaiting_confirmation",
  "target_sender",
  "named_target",
  "person",
]);
export type MessageAdmission = z.infer<typeof MessageAdmission>;

export const CompanyMail = z.enum(["privacy_only", "all"]);
export type CompanyMail = z.infer<typeof CompanyMail>;

// Crockford base32 leaves out I, L, O, and U so a reference survives being read aloud or retyped.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const REFERENCE_LENGTH = 6;
const REFERENCE_PREFIX = "KR-";

export const Reference = z.string().regex(/^KR-[0-9A-HJKMNP-TV-Z]{6}$/);
export type Reference = z.infer<typeof Reference>;

function normalizeCode(raw: string): string | null {
  const code = raw.toUpperCase().replaceAll("O", "0").replaceAll("I", "1").replaceAll("L", "1");
  if (code.length !== REFERENCE_LENGTH) return null;
  for (const char of code) if (!CROCKFORD.includes(char)) return null;
  return code;
}

/** Builds `KR-XXXXXX` from six characters, fixing look-alikes (O, I, L) and case. */
export function formatReference(code: string): Reference {
  const normalized = normalizeCode(code);
  if (!normalized) throw new Error(`"${code}" is not a six character Crockford base32 code`);
  return `${REFERENCE_PREFIX}${normalized}`;
}

export function generateReference(
  randomBytes: (length: number) => Uint8Array = (length) =>
    globalThis.crypto.getRandomValues(new Uint8Array(length)),
): Reference {
  let code = "";
  // 256 is a multiple of 32, so taking the low five bits keeps every character equally likely.
  for (const byte of randomBytes(REFERENCE_LENGTH)) code += CROCKFORD[byte % 32];
  return formatReference(code);
}

/** Every distinct reference in a subject or body, in order of appearance. */
export function parseReferences(text: string): Reference[] {
  const found = new Set<Reference>();
  for (const match of text.matchAll(/\bKR-([0-9A-Za-z]{6})\b/gi)) {
    const code = normalizeCode(match[1] as string);
    if (code) found.add(`${REFERENCE_PREFIX}${code}`);
  }
  return Array.from(found);
}

const ID_PART = /^[A-Za-z0-9_-]+$/;
const DOMAIN_PART = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const OUTGOING_ID = /^<?kr\.([A-Za-z0-9_-]+)\.(\d+)@([A-Za-z0-9.-]+)>?$/;

/**
 * The Message-ID of mail we send. Embedding the request lets a reply's In-Reply-To header
 * identify the request without a database lookup. The sequence keeps follow-ups distinct,
 * because mail servers drop a second message that reuses an ID.
 */
export function outgoingMessageId(requestId: string, domain: string, sequence = 0): string {
  if (!ID_PART.test(requestId)) throw new Error(`"${requestId}" cannot be used in a Message-ID`);
  if (!DOMAIN_PART.test(domain)) throw new Error(`"${domain}" is not a valid Message-ID domain`);
  if (!Number.isInteger(sequence) || sequence < 0)
    throw new Error("sequence must be a whole number");
  return `<kr.${requestId}.${sequence}@${domain}>`;
}

export interface ParsedOutgoingMessageId {
  requestId: string;
  sequence: number;
  domain: string;
}

/** The inverse of {@link outgoingMessageId}; null for any Message-ID we did not make. */
export function parseOutgoingMessageId(id: string): ParsedOutgoingMessageId | null {
  const match = OUTGOING_ID.exec(id.trim());
  if (!match) return null;
  return { requestId: match[1] as string, sequence: Number(match[2]), domain: match[3] as string };
}

export const ProviderPreset = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().min(1),
  /** Empty for the generic preset, where the person types their own hosts. */
  smtpHost: z.string(),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
  imapHost: z.string(),
  imapPort: z.number().int().min(1).max(65535),
  appPasswordUrl: WebUrl.nullable(),
  notes: z.string(),
  defaultDailyCap: z.number().int().positive(),
  supported: z.boolean(),
  /** Why a provider cannot be used, shown in place of the connection form. */
  unsupportedReason: z.string().nullable(),
  /** Whether `name+tag@domain` reaches the same mailbox, so a reply address can be told apart. */
  plusAddressing: z.boolean(),
});
export type ProviderPreset = z.infer<typeof ProviderPreset>;

export const MailFolder = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  /** IMAP special-use flag such as "\\Inbox" or "\\Junk", when the server reports one. */
  specialUse: z.string().nullable(),
});
export type MailFolder = z.infer<typeof MailFolder>;

const Port = z.number().int().min(1).max(65535);

export const MailboxConnection = z.object({
  provider: z.string().min(1),
  address: z.email(),
  username: z.string().min(1),
  /** An app password. Accepted from the client, never sent back. */
  password: z.string().min(1).max(256),
  smtpHost: z.string().min(1),
  smtpPort: Port,
  smtpSecure: z.boolean(),
  imapHost: z.string().min(1),
  imapPort: Port,
});
export type MailboxConnection = z.infer<typeof MailboxConnection>;

/**
 * Testing a mailbox. The password may be left out to test the one already stored, so a person who
 * edits the host does not have to type it again.
 */
export const MailboxTestBody = MailboxConnection.extend({
  password: MailboxConnection.shape.password.optional(),
});
export type MailboxTestBody = z.infer<typeof MailboxTestBody>;

/**
 * Saving a mailbox. When one already exists the password may be left out to keep the stored one.
 */
export const MailboxInput = MailboxConnection.extend({
  password: MailboxConnection.shape.password.optional(),
  replyFolder: z.string().min(1).default("INBOX"),
  dailyCap: z.number().int().min(1).max(2000),
});
export type MailboxInput = z.infer<typeof MailboxInput>;

export const Mailbox = z.object({
  id: z.string(),
  profileId: z.string(),
  provider: z.string(),
  address: z.email(),
  username: z.string(),
  smtpHost: z.string(),
  smtpPort: Port,
  smtpSecure: z.boolean(),
  imapHost: z.string(),
  imapPort: Port,
  replyFolder: z.string(),
  dailyCap: z.number().int().positive(),
  lastPolledAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
  /** While set and in the future, sending is paused because the mail server could not be used. */
  sendPausedUntil: z.iso.datetime().nullable(),
  /** Which mail from a company the person has a request with is taken in. */
  companyMail: CompanyMail,
  replyAlias: z.string().nullable(),
  /** True once a test mail sent to the alias reached this mailbox. */
  replyAliasVerified: z.boolean(),
  /** What the last check looked at and kept, as counts only. */
  lastPollScanned: z.number().int().nonnegative(),
  lastPollKept: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type Mailbox = z.infer<typeof Mailbox>;

/** Why the intake gate passed over a message. */
export const IgnoreRule = z.enum([
  "bulk_no_privacy",
  "company_not_privacy",
  "finished_request",
  "not_named",
  "stranger_bulk",
  "bounce_not_ours",
  "no_wording_found",
]);
export type IgnoreRule = z.infer<typeof IgnoreRule>;

/** How long a message the person confirmed for removal can still be taken back. */
export const IGNORED_KEEP_DAYS = 30;
/** How long after the upgrade the report of passed-over mail is shown. */
export const SHADOW_DAYS = 7;

/** A stored message as a person recognises it: who sent it, what it said, when. */
export const MailLine = z.object({
  id: z.string(),
  fromAddress: z.string(),
  subject: z.string(),
  receivedAt: z.iso.datetime().nullable(),
});
export type MailLine = z.infer<typeof MailLine>;

/**
 * The one-time removal of mail stored before the intake gate. It waits for the person: nothing is
 * removed until they confirm, and `items` is exactly what a confirmation would remove right now.
 */
export const IntakeCleanup = z.object({
  state: z.enum(["pending", "review", "done"]),
  items: z.array(MailLine),
  /** How many were removed by the confirmation; null until then. */
  removed: z.number().int().nonnegative().nullable(),
});
export type IntakeCleanup = z.infer<typeof IntakeCleanup>;

export const IgnoredMessage = MailLine.extend({
  /** The day after which Kick Rocks deletes its copy for good. */
  keptUntil: z.iso.datetime(),
});
export type IgnoredMessage = z.infer<typeof IgnoredMessage>;

export const IntakeIgnored = z.object({ items: z.array(IgnoredMessage) });
export type IntakeIgnored = z.infer<typeof IntakeIgnored>;

export const ShadowLine = MailLine.extend({ rule: IgnoreRule });
export type ShadowLine = z.infer<typeof ShadowLine>;

/** Mail the new rules passed over that the old rules, which kept everything, would have taken in. */
export const IntakeShadow = z.object({
  /** False once the week is over or the person dismissed the report. */
  active: z.boolean(),
  until: z.iso.datetime().nullable(),
  items: z.array(ShadowLine),
});
export type IntakeShadow = z.infer<typeof IntakeShadow>;

export const IntakeSettingsBody = z.object({ companyMail: CompanyMail });
export type IntakeSettingsBody = z.infer<typeof IntakeSettingsBody>;

/** A sender the person asked Kick Rocks to always take in for one target. */
export const IntakeSender = z.object({
  id: z.string(),
  targetId: z.string(),
  targetName: z.string(),
  kind: z.enum(["domain", "address"]),
  value: z.string(),
});
export type IntakeSender = z.infer<typeof IntakeSender>;

export const IntakeSenderBody = z.object({
  targetId: z.string().min(1),
  /** A domain such as `reports.example.org`, or an address; it is told apart by the `@`. */
  value: z.string().trim().min(3).max(254),
});
export type IntakeSenderBody = z.infer<typeof IntakeSenderBody>;

/** The result of sending a test mail to the reply address and looking for it in the mailbox. */
export const ReplyAliasResult = z.object({
  mailbox: Mailbox,
  verified: z.boolean(),
  /** Why the test failed, in words for the person; null when it passed. */
  problem: z.string().nullable(),
});
export type ReplyAliasResult = z.infer<typeof ReplyAliasResult>;

export const FindMissingReplyBody = z.object({
  /** A sender address or domain, or one of our `KR-` references. */
  query: z.string().trim().min(2).max(254),
  from: z.iso.date(),
  to: z.iso.date(),
});
export type FindMissingReplyBody = z.infer<typeof FindMissingReplyBody>;

/** One message a one-off search found, with what the intake rules would have done with it. */
export const FoundMessage = z.object({
  uid: z.number().int(),
  uidValidity: z.number().int(),
  fromAddress: z.string(),
  subject: z.string(),
  receivedAt: z.iso.datetime().nullable(),
  /** Whether Kick Rocks already holds the message. */
  stored: z.boolean(),
  /** The rule that would take it in, or null when the rules would leave it in the mailbox. */
  admittedBy: MessageAdmission.nullable(),
});
export type FoundMessage = z.infer<typeof FoundMessage>;

export const FindMissingReplyResult = z.object({
  messages: z.array(FoundMessage),
  /** False when the server could not search, so nothing could be listed. */
  searched: z.boolean(),
});
export type FindMissingReplyResult = z.infer<typeof FindMissingReplyResult>;

export const TakeInBody = z.object({
  uid: z.number().int(),
  uidValidity: z.number().int(),
});
export type TakeInBody = z.infer<typeof TakeInBody>;

export const MailboxTestResult = z.object({
  smtp: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  imap: z.object({
    ok: z.boolean(),
    error: z.string().nullable(),
    folders: z.array(MailFolder),
  }),
});
export type MailboxTestResult = z.infer<typeof MailboxTestResult>;

/** A stored message as shown in the review queue and on a request's timeline. */
export const MessageSummary = z.object({
  id: z.string(),
  mailboxId: z.string(),
  requestId: z.string().nullable(),
  fromAddress: z.string(),
  subject: z.string(),
  receivedAt: z.iso.datetime(),
  classification: ReplyClassification,
  confidence: z.number().min(0).max(1),
  rationale: z.string().nullable(),
  links: z.array(WebUrl),
  /** For a verification request: the identifiers the broker asked for. Field names, not values. */
  requestedFields: z.array(ProfileField),
  snippet: z.string().nullable(),
  reviewed: z.boolean(),
  /** Why the message was taken in; null for mail stored before the intake gate existed. */
  admittedBy: MessageAdmission.nullable(),
});
export type MessageSummary = z.infer<typeof MessageSummary>;

/** The most message text kept, so one huge mail cannot fill the database. */
export const MESSAGE_TEXT_MAX_CHARS = 20_000;

/** A message with its whole text, for a person classifying mail the rules could not. */
export const MessageDetail = MessageSummary.extend({ text: z.string().nullable() });
export type MessageDetail = z.infer<typeof MessageDetail>;
