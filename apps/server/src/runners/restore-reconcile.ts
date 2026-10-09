import { type MailboxRow, mailboxes, outgoingMail, tasks } from "@kickrocks/db";
import { outgoingMessageId, parseOutgoingMessageId, type RequestRecord } from "@kickrocks/shared";
import { count, eq } from "drizzle-orm";
import type { JournalEntry } from "../core/sent-journal.js";
import type { Task } from "../core/task-types.js";
import type { InboxMessage } from "../mail/types.js";
import type { AppServices } from "../services.js";
import { describeError } from "./connection.js";
import type { EmailRunner, FoundSend } from "./email-send.js";
import { viewSentFolder } from "./sent-folder.js";

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
 * After a restore, finds the mail the restored database never saw, so a request that looks unsent
 * is not mailed to the broker a second time. A message carries its request and its place in that
 * request's sends in its Message-ID, so the check needs no guesswork: the next send for a request
 * is either on record or it is not.
 *
 * The send journal is read first. When it came from the instance that was replaced it holds every
 * send made after the backup, and nothing else is needed. Otherwise each mailbox's Sent folder is
 * read, and trusted only when it shows a send the database knows was made, because a folder that
 * does not file SMTP submissions looks the same when empty as one that was never used.
 *
 * Sending resumes once every mailbox with queued mail has been settled. A mailbox that cannot be
 * settled leaves the hold in place with the reason, because guessing wrong sends a broker a second copy.
 */
export async function reconcileAfterRestore(
  services: AppServices,
  email: EmailRunner,
): Promise<void> {
  const { restoreGate: gate, taskQueue, db, logger, sentJournal } = services;
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

  const journal = sentJournal.entries();
  const unsettled: Pending[] = [];
  for (const item of pending) {
    const found = sequenceFrom(journalSends(journal, item), item);
    if (found) email.settleFromRecord(item.task, item.request, item.mailbox.id, found, "journal");
    else unsettled.push(item);
  }

  const problems: string[] = [];
  if (!sentJournal.coversTheGap()) {
    const byMailbox = new Map<string, Pending[]>();
    for (const item of unsettled) {
      byMailbox.set(item.mailbox.id, [...(byMailbox.get(item.mailbox.id) ?? []), item]);
    }
    for (const items of byMailbox.values()) {
      const mailbox = (items[0] as Pending).mailbox;
      try {
        const oldest = Math.min(...items.map((item) => Date.parse(item.task.createdAt)));
        const view = await viewSentFolder(services, mailbox, new Date(oldest - LOOKBACK_MS));
        if (!view.kept) {
          problems.push(`${mailbox.address}: ${view.reason}.`);
          continue;
        }
        for (const item of items) {
          const found = sequenceFrom(folderSends(view.messages, item), item);
          if (found) {
            email.settleFromRecord(item.task, item.request, mailbox.id, found, "sent_folder");
          } else {
            clearUnconfirmedMarker(services, item.task.id);
          }
        }
      } catch (error) {
        const reason = describeError(error);
        logger.warn({ mailboxId: mailbox.id, err: reason }, "could not check the Sent folder");
        problems.push(`${mailbox.address}: ${reason}`);
      }
    }
  }

  if (problems.length > 0) {
    gate.checked(problems.join(" "));
    return;
  }
  gate.checked(null);
  gate.release("checked");
}

/** A trusted folder that lacks the send proves the offered mail never arrived, so it is sent normally. */
function clearUnconfirmedMarker(services: AppServices, taskId: string): void {
  services.db.update(tasks).set({ unconfirmedMessageId: null }).where(eq(tasks.id, taskId)).run();
}

interface RecordedSend {
  messageId: string;
  recipient: string;
}

function journalSends(journal: readonly JournalEntry[], { request, mailbox }: Pending) {
  return journal.flatMap((entry): RecordedSend[] =>
    entry.channel === "email" &&
    entry.requestId === request.id &&
    parseOutgoingMessageId(entry.ref)?.domain === domainOf(mailbox.address)
      ? [{ messageId: entry.ref, recipient: entry.recipient ?? "" }]
      : [],
  );
}

function folderSends(sent: readonly InboxMessage[], { request, mailbox }: Pending) {
  return sent.flatMap((message): RecordedSend[] =>
    message.messageId &&
    parseOutgoingMessageId(message.messageId)?.requestId === request.id &&
    parseOutgoingMessageId(message.messageId)?.domain === domainOf(mailbox.address)
      ? [{ messageId: message.messageId, recipient: message.to[0] ?? "" }]
      : [],
  );
}

/** The sends of this request from the one the queue was about to make, with nothing missing between. */
function sequenceFrom(sends: readonly RecordedSend[], { request, mailbox, next }: Pending) {
  const bySequence = new Map<number, RecordedSend>();
  for (const send of sends) {
    const parsed = parseOutgoingMessageId(send.messageId);
    if (parsed) bySequence.set(parsed.sequence, send);
  }
  const found: FoundSend = { messageIds: [], recipients: [] };
  for (let sequence = next; bySequence.has(sequence); sequence += 1) {
    const send = bySequence.get(sequence) as RecordedSend;
    found.messageIds.push(outgoingMessageId(request.id, domainOf(mailbox.address), sequence));
    found.recipients.push(send.recipient);
  }
  return found.messageIds.length > 0 ? found : null;
}
