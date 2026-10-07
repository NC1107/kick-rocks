import { type AddressObject, type ParsedMail, simpleParser } from "mailparser";
import type { InboxMessage } from "./types.js";

/** Mail text is cut here so one enormous message cannot exhaust memory before storage trims it. */
const MAX_PARSED_TEXT_CHARS = 200_000;
const MAX_HEADERS = 200;

const BOUNCE_SENDERS = /^(mailer-daemon|mail-daemon|postmaster|mailerdaemon)$/i;

function addressesOf(field: AddressObject | AddressObject[] | undefined) {
  const objects = field === undefined ? [] : Array.isArray(field) ? field : [field];
  return objects
    .flatMap((object) => object.value)
    .filter((entry): entry is { address: string; name: string } => Boolean(entry.address))
    .map((entry) => ({ ...entry, address: entry.address.toLowerCase() }));
}

/** Header names are lower case, and a header that repeats is joined with commas. */
function headerRecord(parsed: ParsedMail): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const { key, line } of parsed.headerLines.slice(0, MAX_HEADERS)) {
    const value = line
      .slice(line.indexOf(":") + 1)
      .replace(/\r?\n[ \t]+/g, " ")
      .trim();
    headers[key] = key in headers ? `${headers[key]}, ${value}` : value;
  }
  return headers;
}

/** A delivery status report, or a mail from a mailer daemon, which is how servers say "bounced". */
export function detectBounce(parsed: ParsedMail, headers: Record<string, string>): boolean {
  const contentType = (headers["content-type"] ?? "").toLowerCase();
  if (contentType.includes("multipart/report") && contentType.includes("delivery-status")) {
    return true;
  }
  if (parsed.attachments.some((part) => part.contentType === "message/delivery-status")) {
    return true;
  }
  if ("x-failed-recipients" in headers) return true;
  const sender = addressesOf(parsed.from)[0]?.address ?? "";
  return BOUNCE_SENDERS.test(sender.split("@")[0] ?? "");
}

/** The `Auto-Submitted` header says a machine sent the mail, unless its value is "no". */
export function detectAutoSubmitted(headers: Record<string, string>): boolean {
  const value = headers["auto-submitted"];
  return value !== undefined && value.trim().toLowerCase() !== "no";
}

function validDate(value: Date | undefined | null): Date | null {
  return value && !Number.isNaN(value.getTime()) ? value : null;
}

export interface ParseInput {
  uid: number;
  source: Buffer;
  /** The server's arrival time, used when the message has no usable Date header. */
  internalDate?: Date | string | undefined;
}

/**
 * Turns a raw message into an `InboxMessage`. A message that cannot be parsed is returned with
 * what is known rather than thrown, so one corrupt mail cannot stall a whole poll.
 */
export async function parseInboxMessage({
  uid,
  source,
  internalDate,
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
  };
}
