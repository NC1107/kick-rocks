import { type MailboxRow, mailboxes, outgoingMail } from "@kickrocks/db";
import { outgoingMessageId, parseOutgoingMessageId, type RequestRecord } from "@kickrocks/shared";
import { count, eq } from "drizzle-orm";
import type { Task } from "../core/task-types.js";
import type { InboxMessage } from "../mail/types.js";
import type { AppServices } from "../services.js";
import { connectionOf, describeError } from "./connection.js";
import type { EmailRunner, FoundSend } from "./email-send.js";

const SENT_FLAG = "\\Sent";
const PAGE_LIMIT = 200;
const MAX_PAGES = 25;
/** Mail sent after the backup can only be newer than the oldest send the restored queue still holds. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1);

interface Pending {
  task: Task<"email_send">;
  request: RequestRecord;
  mailbox: MailboxRow;
  /** The sequence number of the next send the database expects for the request. */
  next: number;
}

/**
 * After a restore, looks in each mailbox's Sent folder for mail the restored database never saw,
 * so a request that looks unsent is not mailed to the broker a second time. A message carries its
 * request and its place in that request's sends in its Message-ID, so the check needs no
 * guesswork: the next send for a request is either in the folder or it is not.
 *
 * Sending resumes once every mailbox with queued mail has been read. A mailbox that cannot be read
 * leaves the hold in place with the reason, because guessing wrong sends a broker a second copy.
 */
export async function reconcileAfterRestore(
  services: AppServices,
  email: EmailRunner,
): Promise<void> {
  const { restoreGate: gate, taskQueue, db, logger } = services;
  if (!gate.checkDue()) return;

  const pending: Pending[] = [];
  for (const task of taskQueue.list({ kinds: ["email_send"], status: ["queued", "leased"] })) {
    if (task.kind !== "email_send") continue;
    const request = services.requests.get(task.payload.requestId);
    if (request?.status !== "queued") continue;
    const mailboxId = email.mailboxIdFor(request);
    const mailbox = mailboxId
      ? db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get()
      : undefined;
    if (!mailbox) continue;
    const next =
      db
        .select({ n: count() })
        .from(outgoingMail)
        .where(eq(outgoingMail.requestId, request.id))
        .get()?.n ?? 0;
    pending.push({ task, request, mailbox, next });
  }

  const problems: string[] = [];
  const byMailbox = new Map<string, Pending[]>();
  for (const item of pending) {
    byMailbox.set(item.mailbox.id, [...(byMailbox.get(item.mailbox.id) ?? []), item]);
  }
  for (const items of byMailbox.values()) {
    const mailbox = (items[0] as Pending).mailbox;
    try {
      const sent = await readSentFolder(services, mailbox, items);
      for (const item of items) {
        const found = sequenceFrom(sent, item);
        if (found) {
          email.settleFromSentFolder(item.task, item.request, mailbox.id, found);
        }
      }
    } catch (error) {
      const reason = describeError(error);
      logger.warn({ mailboxId: mailbox.id, err: reason }, "could not check the Sent folder");
      problems.push(`${mailbox.address}: ${reason}`);
    }
  }

  if (problems.length > 0) {
    gate.checked(problems.join(" "));
    return;
  }
  gate.checked(null);
  gate.release("checked");
}

async function readSentFolder(
  services: AppServices,
  mailbox: MailboxRow,
  items: readonly Pending[],
): Promise<InboxMessage[]> {
  const inbox = services.mail.inbox(connectionOf(mailbox));
  const folders = await inbox.listFolders();
  const sent = folders.find((folder) => folder.specialUse === SENT_FLAG);
  if (!sent) throw new Error("the mailbox reports no Sent folder to check");
  const oldest = Math.min(...items.map((item) => Date.parse(item.task.createdAt)));
  const since = new Date(oldest - LOOKBACK_MS);
  const messages: InboxMessage[] = [];
  let afterUid: number | null = null;
  let uidValidity: number | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await inbox.fetchSince(sent.path, afterUid, uidValidity, {
      since,
      limit: PAGE_LIMIT,
    });
    messages.push(...result.messages);
    uidValidity = result.uidValidity;
    if (!result.hasMore) return messages;
    afterUid = result.messages.at(-1)?.uid ?? afterUid;
  }
  throw new Error("the Sent folder holds more recent mail than could be read");
}

/** The sends of this request in the folder from the one the queue was about to make, with nothing missing between. */
function sequenceFrom(sent: readonly InboxMessage[], { request, mailbox, next }: Pending) {
  const bySequence = new Map<number, InboxMessage>();
  for (const message of sent) {
    const parsed = message.messageId ? parseOutgoingMessageId(message.messageId) : null;
    if (parsed?.requestId === request.id && parsed.domain === domainOf(mailbox.address)) {
      bySequence.set(parsed.sequence, message);
    }
  }
  const found: FoundSend = { messageIds: [], recipients: [] };
  for (let sequence = next; bySequence.has(sequence); sequence += 1) {
    const message = bySequence.get(sequence) as InboxMessage;
    found.messageIds.push(outgoingMessageId(request.id, domainOf(mailbox.address), sequence));
    found.recipients.push(message.to[0] ?? "");
  }
  return found.messageIds.length > 0 ? found : null;
}
