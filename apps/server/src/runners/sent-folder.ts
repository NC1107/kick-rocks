import { type MailboxRow, outgoingMail } from "@kickrocks/db";
import { desc, eq } from "drizzle-orm";
import type { InboxMessage } from "../mail/types.js";
import type { AppServices } from "../services.js";
import { connectionOf } from "./connection.js";

const SENT_FLAG = "\\Sent";
const PAGE_LIMIT = 200;
const MAX_PAGES = 25;
/** The Sent copy is filed a little after the send, and the clocks of two servers differ. */
const WINDOW_MARGIN_MS = 60 * 60 * 1000;
/**
 * A person can delete one Sent copy, so one missing message proves nothing, but a folder that
 * records SMTP sends holds some of the last few.
 */
const PROOF_SENDS = 3;

export const SENT_NOT_KEPT = "this mailbox does not keep sent mail";
export const SENT_UNPROVEN =
  "nothing sent from this mailbox before shows whether its Sent folder keeps sent mail";

const bare = (messageId: string) => messageId.trim().replace(/^<|>$/g, "");

export type SentView = { kept: true; messages: InboxMessage[] } | { kept: false; reason: string };

export async function readSentFolder(
  services: Pick<AppServices, "mail">,
  mailbox: MailboxRow,
  since: Date,
): Promise<InboxMessage[]> {
  const inbox = services.mail.inbox(connectionOf(mailbox));
  const folders = await inbox.listFolders();
  const sent = folders.find((folder) => folder.specialUse === SENT_FLAG);
  if (!sent) throw new Error("the mailbox reports no Sent folder to check");
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

/**
 * Reads the Sent folder from `since`, and says whether an empty result would mean anything. Kick
 * Rocks never files a copy itself, and some providers and self-hosted servers do not file SMTP
 * submissions either, so the folder is trusted only when it shows a send the database knows was made.
 */
export async function viewSentFolder(
  services: Pick<AppServices, "mail" | "db">,
  mailbox: MailboxRow,
  since: Date,
): Promise<SentView> {
  const known = services.db
    .select({ messageId: outgoingMail.messageId, sentAt: outgoingMail.sentAt })
    .from(outgoingMail)
    .where(eq(outgoingMail.mailboxId, mailbox.id))
    .orderBy(desc(outgoingMail.sentAt))
    .limit(PROOF_SENDS)
    .all();
  const oldestProof = known.at(-1);
  const from = oldestProof
    ? new Date(Math.min(since.getTime(), Date.parse(oldestProof.sentAt) - WINDOW_MARGIN_MS))
    : since;
  const messages = await readSentFolder(services, mailbox, from);
  if (known.length === 0) return { kept: false, reason: SENT_UNPROVEN };
  const present = new Set(
    messages.flatMap((message) => (message.messageId ? [bare(message.messageId)] : [])),
  );
  const kept = known.some((row) => present.has(bare(row.messageId)));
  return kept ? { kept: true, messages } : { kept: false, reason: SENT_NOT_KEPT };
}
