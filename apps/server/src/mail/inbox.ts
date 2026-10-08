import type { MailFolder } from "@kickrocks/shared";
import { ImapFlow, type MailboxObject } from "imapflow";
import type { DkimVerifier } from "./dkim.js";
import { describeMailError, isTrustedPlaintextHost } from "./net.js";
import { parseInboxMessage } from "./parse.js";
import type {
  FetchOptions,
  FetchResult,
  InboxMessage,
  InboxSource,
  MailConnection,
} from "./types.js";

const CONNECTION_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 60_000;
/** Bounds what one message can cost, so a mail with a huge attachment cannot exhaust memory. */
const MAX_SOURCE_BYTES = 2_000_000;
const MAX_LITERAL_BYTES = 8_000_000;
const MAX_RESPONSE_BYTES = 32_000_000;
const FETCH_BATCH = 20;
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

    fetchSince(folder, afterUid, uidValidity, options) {
      return withClient(connection, plaintextHosts, (client) =>
        fetchFolder(client, folder, afterUid, uidValidity, options, runDkim),
      );
    },
  };
}

async function fetchFolder(
  client: ImapFlow,
  folder: string,
  afterUid: number | null,
  uidValidity: number | null,
  { since, limit }: FetchOptions,
  dkim: DkimVerifier | undefined,
): Promise<FetchResult> {
  let lock: Awaited<ReturnType<ImapFlow["getMailboxLock"]>>;
  try {
    lock = await client.getMailboxLock(folder, { readOnly: true });
  } catch (error) {
    throw new MailFetchError(
      (error as { mailboxMissing?: boolean }).mailboxMissing
        ? `The folder "${folder}" does not exist on the server.`
        : describeMailError(error),
    );
  }

  try {
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
    const found = await client.search(
      { uid: `${floor + 1}:*`, ...(since ? { since } : {}) },
      { uid: true },
    );
    const matching = (found || []).filter((uid) => uid > floor).sort((a, b) => a - b);
    const wanted = matching.slice(0, limit);

    const messages: InboxMessage[] = [];
    for (let start = 0; start < wanted.length; start += FETCH_BATCH) {
      const batch = wanted.slice(start, start + FETCH_BATCH);
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
    messages.sort((a, b) => a.uid - b.uid);

    return {
      uidValidity: currentValidity,
      reset,
      messages,
      hasMore: matching.length > wanted.length,
      highestUid,
    };
  } finally {
    lock.release();
  }
}
