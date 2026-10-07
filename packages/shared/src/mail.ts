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
  createdAt: z.iso.datetime(),
});
export type Mailbox = z.infer<typeof Mailbox>;

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
});
export type MessageSummary = z.infer<typeof MessageSummary>;

/** The most message text kept, so one huge mail cannot fill the database. */
export const MESSAGE_TEXT_MAX_CHARS = 20_000;

/** A message with its whole text, for a person classifying mail the rules could not. */
export const MessageDetail = MessageSummary.extend({ text: z.string().nullable() });
export type MessageDetail = z.infer<typeof MessageDetail>;
