import { type AddressObject, type ParsedMail, simpleParser } from "mailparser";
import { type DkimVerifier, hasDkimSignature } from "./dkim.js";
import type { InboxMessage } from "./types.js";

/** Mail text is cut here so one enormous message cannot exhaust memory before storage trims it. */
const MAX_PARSED_TEXT_CHARS = 200_000;
const MAX_HEADERS = 200;

/** What is read of one attached original, which can be a whole message with its attachments. */
const MAX_ORIGINAL_BYTES = 64_000;
const MAX_ORIGINAL_IDS = 20;
const ORIGINAL_PART_TYPES = new Set(["message/rfc822", "text/rfc822-headers"]);
const ID_HEADER = /^(message-id|in-reply-to|references):[ \t]*((?:.*)(?:\r?\n[ \t]+.*)*)/gim;

const BOUNCE_SENDERS = /^(mailer-daemon|mail-daemon|postmaster|mailerdaemon)$/i;

export function addressesOf(field: AddressObject | AddressObject[] | undefined) {
  const objects = field === undefined ? [] : Array.isArray(field) ? field : [field];
  return objects
    .flatMap((object) => object.value)
    .filter((entry): entry is { address: string; name: string } => Boolean(entry.address))
    .map((entry) => ({ ...entry, address: entry.address.toLowerCase() }));
}

/** Header names are lower case, and a header that repeats is joined with commas. */
export function headerRecord(parsed: ParsedMail): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const { key, line } of parsed.headerLines.slice(0, MAX_HEADERS)) {
    const value = unfolded(line);
    headers[key] = key in headers ? `${headers[key]}, ${value}` : value;
  }
  return headers;
}

function unfolded(line: string): string {
  return line
    .slice(line.indexOf(":") + 1)
    .replace(/\r?\n[ \t]+/g, " ")
    .trim();
}

/** What the headers alone say about a delivery report, which is all a header scan can see. */
export function looksLikeDeliveryReport(headers: Record<string, string>, sender: string): boolean {
  const contentType = (headers["content-type"] ?? "").toLowerCase();
  if (contentType.includes("multipart/report") && contentType.includes("delivery-status")) {
    return true;
  }
  if ("x-failed-recipients" in headers) return true;
  return BOUNCE_SENDERS.test(sender.split("@")[0] ?? "");
}

/** A delivery status report, or a mail from a mailer daemon, which is how servers say "bounced". */
function detectBounce(parsed: ParsedMail, headers: Record<string, string>): boolean {
  if (parsed.attachments.some((part) => part.contentType === "message/delivery-status")) {
    return true;
  }
  return looksLikeDeliveryReport(headers, addressesOf(parsed.from)[0]?.address ?? "");
}

/** The `Auto-Submitted` header says a machine sent the mail, unless its value is "no". */
function detectAutoSubmitted(headers: Record<string, string>): boolean {
  const value = headers["auto-submitted"];
  return value !== undefined && value.trim().toLowerCase() !== "no";
}

/** The ids in the headers of attached originals, which is where a delivery report says what it is about. */
function originalIdsOf(parsed: ParsedMail): string[] {
  const found = new Set<string>();
  for (const part of parsed.attachments) {
    if (!ORIGINAL_PART_TYPES.has(part.contentType.toLowerCase())) continue;
    const head = part.content.subarray(0, MAX_ORIGINAL_BYTES).toString("utf8");
    const headerBlock = head.split(/\r?\n\r?\n/, 1)[0] ?? "";
    for (const match of headerBlock.matchAll(ID_HEADER)) {
      for (const id of (match[2] ?? "").match(/<[^<>\s]+>/g) ?? []) {
        if (found.size < MAX_ORIGINAL_IDS) found.add(id);
      }
    }
  }
  return [...found];
}

function validDate(value: Date | undefined | null): Date | null {
  return value && !Number.isNaN(value.getTime()) ? value : null;
}

interface ParseInput {
  uid: number;
  source: Buffer;
  /** The server's arrival time, used when the message has no usable Date header. */
  internalDate?: Date | string | undefined;
  /** Without one, no signature is checked and no sender counts as authenticated. A poll run passes the verifier of its own budget. */
  dkim?: DkimVerifier | undefined;
}

/**
 * Turns a raw message into an `InboxMessage`. A message that cannot be parsed is returned with
 * what is known rather than thrown, so one corrupt mail cannot stall a whole poll.
 */
export async function parseInboxMessage({
  uid,
  source,
  internalDate,
  dkim,
}: ParseInput): Promise<InboxMessage> {
  const arrival = validDate(internalDate === undefined ? null : new Date(internalDate));
  let parsed: ParsedMail;
  try {
    parsed = await simpleParser(source, { skipImageLinks: true });
  } catch {
    return {
      uid,
      messageId: null,
      inReplyTo: null,
      references: [],
      from: { name: null, address: "" },
      to: [],
      subject: "",
      date: arrival,
      text: "",
      html: null,
      isBounce: false,
      autoSubmitted: false,
      headers: {},
      originalMessageIds: [],
      verifyDkim: async () => [],
    };
  }

  const headers = headerRecord(parsed);
  const from = addressesOf(parsed.from)[0];
  const references =
    parsed.references === undefined
      ? []
      : Array.isArray(parsed.references)
        ? parsed.references
        : [parsed.references];

  return {
    uid,
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    references,
    from: { name: from?.name ? from.name : null, address: from?.address ?? "" },
    to: addressesOf(parsed.to).map((entry) => entry.address),
    subject: parsed.subject ?? "",
    // The parser quietly turns an unreadable Date header into the current time, which would make an
    // old message look new, so the header is read again here.
    date: validDate(headers.date ? new Date(headers.date) : null) ?? arrival,
    text: (parsed.text ?? "").slice(0, MAX_PARSED_TEXT_CHARS),
    html: typeof parsed.html === "string" ? parsed.html.slice(0, MAX_PARSED_TEXT_CHARS * 2) : null,
    isBounce: detectBounce(parsed, headers),
    autoSubmitted: detectAutoSubmitted(headers),
    headers,
    originalMessageIds: originalIdsOf(parsed),
    verifyDkim:
      dkim && hasDkimSignature(source)
        ? (domains) => dkim.verifiedSignatures(source, domains)
        : async () => [],
  };
}
