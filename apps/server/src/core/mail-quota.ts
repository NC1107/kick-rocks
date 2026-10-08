import { type KickRocksDb, mailboxes, outgoingMail } from "@kickrocks/db";
import type { EmailKind } from "@kickrocks/shared";
import { and, count, desc, eq, gt, lte } from "drizzle-orm";
import { type Clock, nowIso } from "./clock.js";
import { notFound } from "./errors.js";
import { newId } from "./ids.js";

/** The daily cap is counted over a rolling day, not a calendar one, which is how providers count. */
export const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SentMail {
  mailboxId: string;
  requestId: string;
  kind: EmailKind;
  messageId: string;
}

/**
 * The one record of what each mailbox has sent. The email runner writes it, and the daily cap, the
 * pacing between sends, and the dashboard's "sent today" all read it, so they cannot count
 * differently.
 */
export interface MailQuota {
  /** Mail sent from the mailbox after `since`. */
  sentSince(mailboxId: string, since: Date): number;
  /** Mail sent in the 24 hours before now. */
  sentLastDay(mailboxId: string): number;
  /** How many more may go out now before the cap: the cap less what was sent in the last 24 hours. */
  remaining(mailboxId: string): number;
  /** When the last message went out, for the gap between sends. Null if nothing ever has. */
  lastSentAt(mailboxId: string): Date | null;
  /** Records a send, stamped with the injected clock. */
  record(sent: SentMail): void;
}

export function createMailQuota(db: KickRocksDb, clock: Clock): MailQuota {
  // A send stamped by a clock that ran ahead and was put right is not in the past yet, and
  // counting it would hold the cap and the gap shut until that moment arrives.
  const notAfterNow = () => lte(outgoingMail.sentAt, nowIso(clock));

  function sentSince(mailboxId: string, since: Date): number {
    return (
      db
        .select({ n: count() })
        .from(outgoingMail)
        .where(
          and(
            eq(outgoingMail.mailboxId, mailboxId),
            gt(outgoingMail.sentAt, since.toISOString()),
            notAfterNow(),
          ),
        )
        .get()?.n ?? 0
    );
  }

  const windowStart = () => new Date(clock.now().getTime() - QUOTA_WINDOW_MS);

  return {
    sentSince,

    sentLastDay: (mailboxId) => sentSince(mailboxId, windowStart()),

    remaining(mailboxId) {
      const mailbox = db
        .select({ dailyCap: mailboxes.dailyCap })
        .from(mailboxes)
        .where(eq(mailboxes.id, mailboxId))
        .get();
      if (!mailbox) throw notFound(`Mailbox ${mailboxId} not found`, "mailbox_not_found");
      return Math.max(mailbox.dailyCap - sentSince(mailboxId, windowStart()), 0);
    },

    lastSentAt(mailboxId) {
      const row = db
        .select({ sentAt: outgoingMail.sentAt })
        .from(outgoingMail)
        .where(and(eq(outgoingMail.mailboxId, mailboxId), notAfterNow()))
        .orderBy(desc(outgoingMail.sentAt))
        .limit(1)
        .get();
      return row ? new Date(row.sentAt) : null;
    },

    record(sent) {
      db.insert(outgoingMail)
        .values({ id: newId(), ...sent, sentAt: nowIso(clock) })
        .run();
    },
  };
}
