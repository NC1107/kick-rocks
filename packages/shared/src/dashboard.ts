import { z } from "zod";
import { ListingsSummary } from "./listings.js";
import { Reference } from "./mail.js";
import { NeedsYouCounts } from "./needs-you.js";
import { RequestStatus, requestEventSchema } from "./requests.js";
import { ScanHoldReason, ScanReadiness } from "./scans.js";

export const DashboardEvent = requestEventSchema({
  requestReference: Reference,
  targetName: z.string(),
  targetId: z.string(),
  /** How many events the request has in all, set when the event stands for its whole request. */
  eventCount: z.number().int().positive().optional(),
});
export type DashboardEvent = z.infer<typeof DashboardEvent>;

const Count = z.number().int().nonnegative();

/** Scans of one reason that are queued and not starting. */
export const ScanHoldGroup = z.object({
  count: z.number().int().positive(),
  /** The soonest any of them is let go, when the reason ends by itself. */
  until: z.iso.datetime().optional(),
  serverClock: z.boolean().optional(),
});
export type ScanHoldGroup = z.infer<typeof ScanHoldGroup>;

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
    /** Tasks that failed for good in the last 30 days on a request that is still open. */
    failedTasks: Count,
    /** Agent tasks no MCP client has claimed yet, listed under "Waiting for an agent". */
    agentTasks: Count,
    /** Agent tasks the person took for themselves. No agent will claim these. */
    yourAgentTasks: Count,
    /** Of `agentTasks`, how many are assigned to a named agent, and which agents. */
    assignedAgentTasks: Count,
    agentAssignees: z.array(z.string()),
    /** What the focused "Needs you" queue holds, the same numbers `GET /needs-you` gives. */
    needsYou: NeedsYouCounts,
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
  /** Queued scans, and how many of them something is holding back. */
  scans: z.object({
    queued: z.number().int().nonnegative(),
    held: z.number().int().nonnegative(),
    byReason: z.partialRecord(ScanHoldReason, ScanHoldGroup),
  }),
  /** What stops scans from starting: missing profile details, sites that need an agent or a review, quiet hours. */
  scanning: ScanReadiness.extend({
    quiet: z.object({ until: z.iso.datetime(), zoneUnset: z.boolean() }).nullable(),
  }),
  /** Where the profile is listed, by status, and when scans last ran and next will. */
  listings: ListingsSummary,
  recentEvents: z.array(DashboardEvent),
});
export type Dashboard = z.infer<typeof Dashboard>;
