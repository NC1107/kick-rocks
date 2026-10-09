import type { MailFolder } from "@kickrocks/shared";
import { ImapFlow, type MailboxObject } from "imapflow";
import { simpleParser } from "mailparser";
import type { DkimVerifier } from "./dkim.js";
import { addressesIn } from "./intake.js";
import { describeMailError, isTrustedPlaintextHost } from "./net.js";
import { addressesOf, headerRecord, looksLikeDeliveryReport, parseInboxMessage } from "./parse.js";
import type {
  FolderSearch,
  InboxMessage,
  InboxSession,
  InboxSource,
  MailConnection,
  MessageHeaders,
  ScanOptions,
  ScanResult,
} from "./types.js";

const CONNECTION_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 60_000;
/** Bounds what one message can cost, so a mail with a huge attachment cannot exhaust memory. */
const MAX_SOURCE_BYTES = 2_000_000;
const MAX_LITERAL_BYTES = 8_000_000;
const MAX_RESPONSE_BYTES = 32_000_000;
const FETCH_BATCH = 20;
const HEADER_BATCH = 100;
/** A server that is slow to search is treated as one that cannot, since the fallback costs only bandwidth. */
const SEARCH_TIMEOUT_MS = 30_000;
const SEARCH_TERM_CHUNK = 25;
const SEARCH_UID_CHUNK = 500;
/** The fields that decide almost every message, so a header scan costs a kilobyte or two each. */
const SCANNED_HEADERS = [
  "From",
  "Sender",
  "Reply-To",
  "To",
  "Cc",
  "Delivered-To",
  "X-Original-To",
  "Subject",
  "Message-ID",
  "In-Reply-To",
  "References",
  "List-Id",
  "List-Unsubscribe",
  "Precedence",
  "Auto-Submitted",
  "Content-Type",
  "X-Failed-Recipients",
  "Date",
];
const IMPLICIT_TLS_PORT = 993;

/** A mailbox that could not be read. The text is safe to show and never contains the password. */
class MailFetchError extends Error {
  override name = "MailFetchError";
}

/** Hosts that may be reached without TLS besides this machine. */
interface InboxSourceOptions {
  plaintextHosts?: readonly string[];
  /** Checks the DKIM signatures of each fetched message; without one no sender is authenticated. */
  dkim?: DkimVerifier;
}

function openClient(connection: MailConnection, plaintextHosts: readonly string[]): ImapFlow {
  const local = isTrustedPlaintextHost(connection.imapHost, plaintextHosts);
  const secure = connection.imapPort === IMPLICIT_TLS_PORT;
  const client = new ImapFlow({
    host: connection.imapHost,
    port: connection.imapPort,
    secure,
    // Credentials must not cross the network unencrypted, so STARTTLS is mandatory unless the
    // server is on this machine or named by the operator, as with Proton Bridge and the test mail server.
    ...(secure || local ? {} : { doSTARTTLS: true }),
    ...(local ? { tls: { rejectUnauthorized: false } } : {}),
    auth: { user: connection.username, pass: connection.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: CONNECTION_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    maxLiteralSize: MAX_LITERAL_BYTES,
    maxResponseSize: MAX_RESPONSE_BYTES,
  });
  // A dropped socket is reported through the command that was waiting on it; without a listener
  // the same error would also be thrown as an unhandled event and stop the process.
  client.on("error", () => {});
  return client;
}

async function withClient<T>(
  connection: MailConnection,
  plaintextHosts: readonly string[],
  work: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = openClient(connection, plaintextHosts);
  try {
    await client.connect();
    return await work(client);
  } catch (error) {
    throw error instanceof MailFetchError
      ? error
      : new MailFetchError(describeMailError(error, [connection.password]));
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

function folderRank(folder: MailFolder): number {
  if (folder.path.toUpperCase() === "INBOX") return 0;
  return folder.specialUse ? 1 : 2;
}

export function createInboxSource(
  connection: MailConnection,
  { plaintextHosts = [], dkim }: InboxSourceOptions = {},
): InboxSource {
  const runDkim = dkim?.forRun();
  return {
    listFolders() {
      return withClient(connection, plaintextHosts, async (client) => {
        const listed = await client.list();
        const folders = listed
          .filter((entry) => !entry.flags.has("\\Noselect") && !entry.flags.has("\\NonExistent"))
          .map(
            (entry): MailFolder => ({
              path: entry.path,
              name: entry.name || entry.path,
              specialUse:
                entry.specialUse ?? (entry.path.toUpperCase() === "INBOX" ? "\\Inbox" : null),
            }),
          );
        return folders.sort(
          (a, b) => folderRank(a) - folderRank(b) || a.path.localeCompare(b.path),
        );
      });
    },

    withFolder(folder, work) {
      return withClient(connection, plaintextHosts, async (client) => {
        const lock = await lockFolder(client, folder);
        try {
          return await work(sessionOn(client, runDkim));
        } finally {
          lock.release();
        }
      });
    },
  };
}

async function lockFolder(client: ImapFlow, folder: string) {
  try {
    return await client.getMailboxLock(folder, { readOnly: true });
  } catch (error) {
    throw new MailFetchError(
      (error as { mailboxMissing?: boolean }).mailboxMissing
        ? `The folder "${folder}" does not exist on the server.`
        : describeMailError(error),
    );
  }
}

function messagesWithin(uids: readonly number[], size: number): number[][] {
  const chunks: number[][] = [];
  for (let start = 0; start < uids.length; start += size) {
    chunks.push(uids.slice(start, start + size));
  }
  return chunks;
}

/** Whether a body structure holds a delivery status part, which only the full tree shows. */
function hasDeliveryStatus(node: unknown): boolean {
  const part = node as { type?: string; childNodes?: unknown[] } | undefined;
  if (!part) return false;
  if (part.type === "message/delivery-status") return true;
  return (part.childNodes ?? []).some(hasDeliveryStatus);
}

async function headersOfFetched(item: {
  uid: number;
  internalDate?: Date | string | undefined;
  headers?: Buffer | undefined;
  bodyStructure?: unknown;
}): Promise<MessageHeaders> {
  // The block holds header lines only, so the parser reads fields and finds no body.
  const parsed = await simpleParser(item.headers ?? Buffer.alloc(0));
  const headers = headerRecord(parsed);
  const from = addressesOf(parsed.from)[0];
  const arrival = item.internalDate ? new Date(item.internalDate) : null;
  const dated = headers.date ? new Date(headers.date) : null;
  const references =
    parsed.references === undefined
      ? []
      : Array.isArray(parsed.references)
        ? parsed.references
        : [parsed.references];
  return {
    uid: item.uid,
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    references,
    from: { name: from?.name ? from.name : null, address: from?.address ?? "" },
    recipients: [
      ...new Set([
        ...addressesOf(parsed.to).map((entry) => entry.address),
        ...["cc", "delivered-to", "x-original-to"].flatMap((name) => addressesIn(headers[name])),
      ]),
    ],
    subject: parsed.subject ?? "",
    date: dated && !Number.isNaN(dated.getTime()) ? dated : arrival,
    isDeliveryReport:
      hasDeliveryStatus(item.bodyStructure) ||
      looksLikeDeliveryReport(headers, from?.address ?? ""),
    headers,
  };
}

function sessionOn(client: ImapFlow, dkim: DkimVerifier | undefined): InboxSession {
  const fetchHeaders = async (uids: readonly number[]): Promise<MessageHeaders[]> => {
    const found: MessageHeaders[] = [];
    for (const batch of messagesWithin(uids, HEADER_BATCH)) {
      const fetched = await client.fetchAll(
        batch.join(","),
        {
          uid: true,
          internalDate: true,
          bodyStructure: true,
          headers: SCANNED_HEADERS,
        },
        { uid: true },
      );
      for (const item of fetched) found.push(await headersOfFetched(item));
    }
    return found.sort((a, b) => a.uid - b.uid);
  };

  const searchUids = async (query: Record<string, unknown>): Promise<number[]> => {
    const found = await client.search(query, { uid: true });
    return (found || []).sort((a, b) => a - b);
  };

  const bounded = async <T>(work: Promise<T>): Promise<T | null> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), SEARCH_TIMEOUT_MS);
        }),
      ]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    uidValidity: () => Number((client.mailbox as MailboxObject).uidValidity),

    async scan(afterUid, uidValidity, { since, limit }: ScanOptions): Promise<ScanResult> {
      const mailbox = client.mailbox as MailboxObject;
      const currentValidity = Number(mailbox.uidValidity);
      const reset = uidValidity !== null && uidValidity !== currentValidity;
      const floor = reset ? 0 : (afterUid ?? 0);

      if (mailbox.exists === 0) {
        return {
          uidValidity: currentValidity,
          reset,
          messages: [],
          hasMore: false,
          highestUid: null,
        };
      }

      const newest = await client.fetchOne("*", { uid: true });
      const highestUid = newest ? newest.uid : null;
      // `N:*` matches the newest message even when N is beyond it, so the floor is applied again.
      const matching = (
        await searchUids({ uid: `${floor + 1}:*`, ...(since ? { since } : {}) })
      ).filter((uid) => uid > floor);
      const wanted = matching.slice(0, limit);
      return {
        uidValidity: currentValidity,
        reset,
        messages: await fetchHeaders(wanted),
        hasMore: matching.length > wanted.length,
        highestUid,
      };
    },

    headers: fetchHeaders,

    async searchBodies(uids, terms) {
      if (uids.length === 0 || terms.length === 0) return new Set();
      const hits = new Set<number>();
      for (const uidChunk of messagesWithin(uids, SEARCH_UID_CHUNK)) {
        for (const termChunk of messagesWithinTerms(terms)) {
          const query = {
            uid: uidChunk.join(","),
            ...(termChunk.length === 1
              ? { body: termChunk[0] }
              : { or: termChunk.map((term) => ({ body: term })) }),
          };
          const found = await bounded(searchUids(query));
          if (found === null) return null;
          for (const uid of found) hits.add(uid);
        }
      }
      return hits;
    },

    async search({ since, until, messageId, from = [], text = [], limit }: FolderSearch) {
      const base = {
        since,
        ...(until ? { before: until } : {}),
        ...(messageId ? { header: { "message-id": messageId } } : {}),
      };
      const anyOf = (key: "from" | "body", values: string[]) =>
        values.length === 1
          ? { [key]: values[0] }
          : { or: values.map((value) => ({ [key]: value })) };
      // IMAP cannot express two alternatives lists ANDed in one criteria object, so they are asked separately.
      const queries = [
        ...(from.length > 0 ? [{ ...base, ...anyOf("from", from) }] : []),
        ...(text.length > 0 ? [{ ...base, ...anyOf("body", text) }] : []),
      ];
      const answers = await bounded(
        Promise.all((queries.length > 0 ? queries : [base]).map((query) => searchUids(query))),
      );
      if (answers === null) return null;
      const [first = [], ...rest] = answers;
      const common = first.filter((uid) => rest.every((other) => other.includes(uid)));
      return common.slice(-limit);
    },

    async fetchMessages(uids): Promise<InboxMessage[]> {
      const messages: InboxMessage[] = [];
      for (const batch of messagesWithin(uids, FETCH_BATCH)) {
        const fetched = await client.fetchAll(
          batch.join(","),
          { uid: true, internalDate: true, source: { start: 0, maxLength: MAX_SOURCE_BYTES } },
          { uid: true },
        );
        for (const item of fetched) {
          if (!item.source) continue;
          messages.push(
            await parseInboxMessage({
              uid: item.uid,
              source: item.source,
              internalDate: item.internalDate,
              dkim,
            }),
          );
        }
      }
      return messages.sort((a, b) => a.uid - b.uid);
    },
  };
}

function messagesWithinTerms(terms: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < terms.length; start += SEARCH_TERM_CHUNK) {
    chunks.push(terms.slice(start, start + SEARCH_TERM_CHUNK));
  }
  return chunks;
}
