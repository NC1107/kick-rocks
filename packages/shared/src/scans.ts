import { z } from "zod";
import { TargetOutcome } from "./campaigns.js";
import { Candidate, TaskStatus } from "./tasks.js";

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
  recordUrl: z.url(),
  fields: MatchFields,
  decision: MatchDecision,
  decidedAt: z.iso.datetime().nullable(),
  /** The removal request a "mine" decision created. */
  requestId: z.string().nullable(),
});
export type Match = z.infer<typeof Match>;

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
});
export type ScanSummary = z.infer<typeof ScanSummary>;

export const ScanStartBody = z.union([
  z.object({ targetIds: z.array(z.string().min(1)).min(1).max(5000) }).strict(),
  z.object({ preset: z.literal("people_search") }).strict(),
]);
export type ScanStartBody = z.infer<typeof ScanStartBody>;

export const ScanStartResult = z.object({ items: z.array(TargetOutcome) });
export type ScanStartResult = z.infer<typeof ScanStartResult>;
