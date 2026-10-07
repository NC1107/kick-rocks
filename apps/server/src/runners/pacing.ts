import { type MailboxRow, mailboxes, outgoingMail } from "@kickrocks/db";
import { and, asc, eq, gt } from "drizzle-orm";
import { DEFAULT_SEND_GAP_MS } from "../config.js";
import { QUOTA_WINDOW_MS } from "../core/mail-quota.js";
import type { AppServices } from "../services.js";

export interface GapRange {
  min: number;
  max: number;
}

export const MIN_GAP_MS = DEFAULT_SEND_GAP_MS.min;
export const MAX_GAP_MS = DEFAULT_SEND_GAP_MS.max;
const MAILBOX_HOLD_BASE_MS = 5 * 60 * 1000;
const MAILBOX_HOLD_MAX_MS = 60 * 60 * 1000;

/**
 * Decides when a mailbox may send next: not before the gap since its last send, and not while it
 * has used its whole daily cap over the last 24 hours. Providers flag a mailbox that sends in
 * bursts, so the gap is random between 20 and 60 seconds, chosen once per send so that a task
 * told to wait comes back exactly when the gap ends rather than being turned away again.
 */
export class MailPacer {
  private readonly gaps = new Map<string, { lastSentMs: number; gapMs: number }>();
  private readonly holds = new Map<string, { until: number; failures: number }>();

  constructor(
    private readonly services: Pick<AppServices, "db" | "clock" | "mailQuota">,
    private readonly random: () => number,
    private readonly gap: GapRange = { min: MIN_GAP_MS, max: MAX_GAP_MS },
  ) {}

  /** When the mailbox may send again; null when it may send now. */
  waitUntil(mailbox: Pick<MailboxRow, "id" | "dailyCap">): Date | null {
    const now = this.services.clock.now().getTime();
    const candidates = [this.gapEnd(mailbox.id), this.capLifts(mailbox), this.holdEnd(mailbox.id)]
      .filter((at): at is Date => at !== null)
      .filter((at) => at.getTime() > now);
    if (candidates.length === 0) return null;
    return new Date(Math.max(...candidates.map((at) => at.getTime())));
  }

  /**
   * Stops a mailbox that cannot reach its server or log in, for longer after each failure in a row.
   * Every send waiting behind it would fail the same way, and a short outage would otherwise use
   * up the attempts of the whole queue.
   */
  hold(mailboxId: string): Date {
    const failures = (this.holds.get(mailboxId)?.failures ?? 0) + 1;
    const delay = Math.min(MAILBOX_HOLD_MAX_MS, MAILBOX_HOLD_BASE_MS * 2 ** (failures - 1));
    const until = this.services.clock.now().getTime() + delay;
    this.holds.set(mailboxId, { until, failures });
    return new Date(until);
  }

  /** The mailbox worked, so the next failure starts from the shortest hold again. */
  clearHold(mailboxId: string): void {
    this.holds.delete(mailboxId);
  }

  private holdEnd(mailboxId: string): Date | null {
    const hold = this.holds.get(mailboxId);
    return hold ? new Date(hold.until) : null;
  }

  /** Profiles whose mailbox has to wait, so a claim does not lease a send that cannot go yet. */
  waitingProfileIds(): string[] {
    return this.services.db
      .select()
      .from(mailboxes)
      .all()
      .filter((mailbox) => this.waitUntil(mailbox) !== null)
      .map((mailbox) => mailbox.profileId);
  }

  private gapEnd(mailboxId: string): Date | null {
    const last = this.services.mailQuota.lastSentAt(mailboxId);
    if (!last) return null;
    const known = this.gaps.get(mailboxId);
    const gapMs =
      known && known.lastSentMs === last.getTime()
        ? known.gapMs
        : Math.min(
            this.gap.max,
            this.gap.min + Math.floor(this.random() * (this.gap.max - this.gap.min + 1)),
          );
    this.gaps.set(mailboxId, { lastSentMs: last.getTime(), gapMs });
    return new Date(last.getTime() + gapMs);
  }

  /** The moment the send that frees the next slot leaves the 24 hour window. */
  private capLifts(mailbox: Pick<MailboxRow, "id" | "dailyCap">): Date | null {
    if (this.services.mailQuota.remaining(mailbox.id) > 0) return null;
    const windowStart = new Date(this.services.clock.now().getTime() - QUOTA_WINDOW_MS);
    const inWindow = this.services.db
      .select({ sentAt: outgoingMail.sentAt })
      .from(outgoingMail)
      .where(
        and(
          eq(outgoingMail.mailboxId, mailbox.id),
          gt(outgoingMail.sentAt, windowStart.toISOString()),
        ),
      )
      .orderBy(asc(outgoingMail.sentAt))
      .all();
    const freeing = inWindow[Math.max(inWindow.length - mailbox.dailyCap, 0)];
    return freeing ? new Date(Date.parse(freeing.sentAt) + QUOTA_WINDOW_MS) : null;
  }
}
