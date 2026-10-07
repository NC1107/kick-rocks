import type { Clock } from "./clock.js";

const HOLD_BASE_MS = 5 * 60 * 1000;
const HOLD_MAX_MS = 60 * 60 * 1000;

/**
 * Mailboxes that sending has stopped for, because the server could not be reached or refused the
 * login. Every send queued behind one would fail the same way, so it waits, for longer after each
 * failure in a row. The state is in memory on purpose: a restart is itself a fresh start. The
 * mailbox form and the connection test share it, so a fixed mailbox is not left waiting out a
 * pause its old settings earned.
 */
export interface MailHolds {
  /** Starts or extends a hold and returns when it ends. */
  hold(mailboxId: string): Date;
  /** The mailbox worked, or was fixed, so the next failure starts from the shortest hold again. */
  clear(mailboxId: string): void;
  /** When a hold still in force ends; null when the mailbox is not held. */
  until(mailboxId: string): Date | null;
}

export function createMailHolds(clock: Clock): MailHolds {
  const holds = new Map<string, { until: number; failures: number }>();
  return {
    hold(mailboxId) {
      const failures = (holds.get(mailboxId)?.failures ?? 0) + 1;
      const delay = Math.min(HOLD_MAX_MS, HOLD_BASE_MS * 2 ** (failures - 1));
      const until = clock.now().getTime() + delay;
      holds.set(mailboxId, { until, failures });
      return new Date(until);
    },
    clear(mailboxId) {
      holds.delete(mailboxId);
    },
    until(mailboxId) {
      const hold = holds.get(mailboxId);
      return hold && hold.until > clock.now().getTime() ? new Date(hold.until) : null;
    },
  };
}
