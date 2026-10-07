import { z } from "zod";
import { RenderedEmail } from "./legal.js";
import { RequestRight } from "./requests.js";

export const CampaignPreset = z.enum(["companies", "email_brokers", "people_search", "everything"]);
export type CampaignPreset = z.infer<typeof CampaignPreset>;

export const CampaignSelection = z.union([
  z.object({ targetIds: z.array(z.string().min(1)).min(1).max(5000) }).strict(),
  z.object({ preset: CampaignPreset }).strict(),
]);
export type CampaignSelection = z.infer<typeof CampaignSelection>;

export const CampaignBody = z.object({
  selection: CampaignSelection,
  rights: z
    .array(RequestRight)
    .min(1)
    .refine((rights) => new Set(rights).size === rights.length, {
      message: "Rights must be unique",
    }),
});
export type CampaignBody = z.infer<typeof CampaignBody>;

export const TargetOutcomeKind = z.enum(["request_created", "scan_started", "skipped"]);
export type TargetOutcomeKind = z.infer<typeof TargetOutcomeKind>;

export const SkipReason = z.enum(["already_active", "no_contact_method", "scan_in_progress"]);
export type SkipReason = z.infer<typeof SkipReason>;

/** What happened, or for a preview what would happen, to one target. */
export const TargetOutcome = z.object({
  targetId: z.string(),
  targetName: z.string(),
  outcome: TargetOutcomeKind,
  requestId: z.string().nullable(),
  scanId: z.string().nullable(),
  reason: SkipReason.nullable(),
});
export type TargetOutcome = z.infer<typeof TargetOutcome>;

export const OutcomeCounts = z.object({
  request_created: z.number().int().nonnegative(),
  scan_started: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type OutcomeCounts = z.infer<typeof OutcomeCounts>;

export function countOutcomes(items: readonly Pick<TargetOutcome, "outcome">[]): OutcomeCounts {
  const counts: OutcomeCounts = { request_created: 0, scan_started: 0, skipped: 0 };
  for (const item of items) counts[item.outcome] += 1;
  return counts;
}

export const CampaignPreview = z.object({
  items: z.array(TargetOutcome),
  counts: OutcomeCounts,
  /** The first email that would go out, so the person can read it before sending. */
  sampleEmail: RenderedEmail.nullable(),
});
export type CampaignPreview = z.infer<typeof CampaignPreview>;

export const CampaignCreated = z.object({
  campaignId: z.string(),
  items: z.array(TargetOutcome),
  counts: OutcomeCounts,
});
export type CampaignCreated = z.infer<typeof CampaignCreated>;
