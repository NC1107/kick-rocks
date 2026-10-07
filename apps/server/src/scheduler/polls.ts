import { mailboxes } from "@kickrocks/db";
import type { AppServices } from "../services.js";

const MINUTE_MS = 60 * 1000;

/**
 * Queues an inbox poll for every mailbox that has not been polled for `pollMinutes`. A failed poll
 * stamps the mailbox too, so a broken connection is retried on the same cadence instead of every
 * pass of the scheduler.
 */
export function enqueueDueInboxPolls(services: AppServices): number {
  const { pollMinutes } = services.settings.get("schedule");
  const now = services.clock.now().getTime();
  let queued = 0;
  for (const mailbox of services.db.select().from(mailboxes).all()) {
    const last = mailbox.lastPolledAt ? Date.parse(mailbox.lastPolledAt) : null;
    if (last !== null && last + pollMinutes * MINUTE_MS > now) continue;
    if (services.dispatch.enqueueInboxPoll(mailbox.id).created) queued += 1;
  }
  return queued;
}
