import { z } from "zod";
import { FilterSelection, TargetOutcome } from "./campaigns.js";
import { WaitReason } from "./scanning.js";
import { MAX_SELECTED_TARGETS } from "./targets.js";
import { Candidate, TaskStatus } from "./tasks.js";
import { WebUrl } from "./url.js";

export const MatchDecision = z.enum(["pending", "mine", "not_mine"]);
export type MatchDecision = z.infer<typeof MatchDecision>;

/** What a scan read off a record, without the url that identifies it. */
export const MatchFields = Candidate.omit({ recordUrl: true });
export type MatchFields = z.infer<typeof MatchFields>;

export const Match = z.object({
  id: z.string(),
  scanId: z.string(),
  profileId: z.string(),
  targetId: z.string(),
  targetName: z.string(),
  recordUrl: WebUrl,
  fields: MatchFields,
  decision: MatchDecision,
  decidedAt: z.iso.datetime().nullable(),
  /** The removal request a "mine" decision created. */
  requestId: z.string().nullable(),
});
export type Match = z.infer<typeof Match>;

/** Why a scan that has not started is still queued. `agent` means no scripted search exists for the site. */
export const ScanWait = z.object({
  reason: z.union([WaitReason, z.literal("agent")]),
  /** When the wait ends by itself; null when it needs a person or an agent. */
  until: z.iso.datetime().nullable(),
});
export type ScanWait = z.infer<typeof ScanWait>;

/** What a profile can be scanned on, so a scan that cannot run is explained before it is started. */
export const ScanReadiness = z.object({
  /** People-search sites a worker can scan for this profile now. */
  ready: z.number().int().nonnegative(),
  /** Sites with no scripted search, which wait for a connected agent. */
  needsAgent: z.number().int().nonnegative(),
  /** Sites the profile lacks details for. */
  needsDetails: z.number().int().nonnegative(),
  /** What to add, in the profile's terms; null when nothing is missing. */
  missing: z.string().nullable(),
});
export type ScanReadiness = z.infer<typeof ScanReadiness>;

export const ScanSummary = z.object({
  id: z.string(),
  profileId: z.string(),
  targetId: z.string(),
  targetName: z.string(),
  taskId: z.string().nullable(),
  taskStatus: TaskStatus.nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  candidateCount: z.number().int().nonnegative(),
  matchCounts: z.object({
    pending: z.number().int().nonnegative(),
    mine: z.number().int().nonnegative(),
    not_mine: z.number().int().nonnegative(),
  }),
  error: z.string().nullable(),
  /** Set while the scan is queued and something holds it back. */
  waiting: ScanWait.nullable(),
});
export type ScanSummary = z.infer<typeof ScanSummary>;

export const ScanStartBody = z.union([
  z.object({ targetIds: z.array(z.string().min(1)).min(1).max(MAX_SELECTED_TARGETS) }).strict(),
  z.object({ preset: z.literal("people_search") }).strict(),
  FilterSelection,
]);
export type ScanStartBody = z.infer<typeof ScanStartBody>;

export const ScanStartResult = z.object({ items: z.array(TargetOutcome) });
export type ScanStartResult = z.infer<typeof ScanStartResult>;
