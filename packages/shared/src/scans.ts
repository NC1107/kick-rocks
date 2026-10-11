import { z } from "zod";
import { TargetOutcome } from "./campaigns.js";
import { ProfileField } from "./identities.js";
import { MatchAssessment } from "./match-score.js";
import { WaitReason } from "./scanning.js";
import { MAX_SELECTED_TARGETS, TargetFilter } from "./targets.js";
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
  /** How well the record fits the profile. Advice only: the person decides. Null on matches made before scoring. */
  assessment: MatchAssessment.nullable(),
  decision: MatchDecision,
  decidedAt: z.iso.datetime().nullable(),
  /** The removal request a "mine" decision created. */
  requestId: z.string().nullable(),
});
export type Match = z.infer<typeof Match>;

/** Why a scan that has not started is still queued: the site is being given time, or nothing can run it yet. */
export const ScanHoldReason = z.union([
  WaitReason,
  z.enum(["missing_fields", "no_recipe", "recipe_unapproved", "agent_required"]),
]);
export type ScanHoldReason = z.infer<typeof ScanHoldReason>;

export const ScanHold = z.object({
  reason: ScanHoldReason,
  /** When the hold ends by itself. Left out when it needs a person or an agent. */
  until: z.iso.datetime().optional(),
  /** A sentence for a person, such as what the profile is missing. */
  detail: z.string().optional(),
  /** The profile details a scan of the site needs and the profile lacks. */
  fields: z.array(ProfileField).optional(),
  /** The site being given time, for the reasons that are about one site. */
  domain: z.string().optional(),
  /** Set when quiet hours are read on the server's own clock because no time zone is chosen. */
  serverClock: z.boolean().optional(),
});
export type ScanHold = z.infer<typeof ScanHold>;

/** What a profile can be scanned on, so a scan that cannot run is explained before it is started. */
export const ScanReadiness = z.object({
  /** People-search sites a worker can scan for this profile now. */
  ready: z.number().int().nonnegative(),
  /** Sites with no scripted search, which wait for a connected agent. */
  noRecipe: z.number().int().nonnegative(),
  /** Sites whose scripted search waits for the person's review before the built-in worker runs it. */
  recipeNeedsReview: z.number().int().nonnegative(),
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
  hold: ScanHold.nullable(),
});
export type ScanSummary = z.infer<typeof ScanSummary>;

/** "all" also searches under each past address, one separate visit per address. */
export const ScanAddresses = z.enum(["current", "all"]);
export type ScanAddresses = z.infer<typeof ScanAddresses>;

export const ScanStartBody = z.union([
  z
    .object({
      targetIds: z.array(z.string().min(1)).min(1).max(MAX_SELECTED_TARGETS),
      addresses: ScanAddresses.optional(),
    })
    .strict(),
  z.object({ preset: z.literal("people_search"), addresses: ScanAddresses.optional() }).strict(),
  z.object({ filter: TargetFilter.strict(), addresses: ScanAddresses.optional() }).strict(),
]);
export type ScanStartBody = z.infer<typeof ScanStartBody>;

export const ScanStartResult = z.object({ items: z.array(TargetOutcome) });
export type ScanStartResult = z.infer<typeof ScanStartResult>;
