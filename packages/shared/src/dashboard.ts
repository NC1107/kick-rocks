import { z } from "zod";
import { Reference } from "./mail.js";
import { RequestEvent, RequestStatus } from "./requests.js";

export const DashboardEvent = RequestEvent.extend({
  requestReference: Reference,
  targetName: z.string(),
});
export type DashboardEvent = z.infer<typeof DashboardEvent>;

const Count = z.number().int().nonnegative();

export const Dashboard = z.object({
  profileId: z.string(),
  total: Count,
  /** Requests per status. Every status is present, with 0 when there are none. */
  counts: z.record(RequestStatus, Count),
  attention: z.object({
    blockedTasks: Count,
    pendingMatches: Count,
    unreviewedMessages: Count,
    needsVerification: Count,
  }),
  /** Mail sent in the last 24 hours against the mailbox cap; null without a mailbox. */
  sending: z
    .object({
      sent: Count,
      cap: Count,
      remaining: Count,
    })
    .nullable(),
  mailbox: z
    .object({
      address: z.email(),
      lastPolledAt: z.iso.datetime().nullable(),
      lastError: z.string().nullable(),
    })
    .nullable(),
  recentEvents: z.array(DashboardEvent),
});
export type Dashboard = z.infer<typeof Dashboard>;
