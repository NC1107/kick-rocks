import { z } from "zod";
import { RenderedEmail } from "./legal.js";
import { RequestRights } from "./requests.js";

export const CampaignPreset = z.enum(["companies", "email_brokers", "people_search", "everything"]);
export type CampaignPreset = z.infer<typeof CampaignPreset>;

export const CampaignSelection = z.union([
  z.object({ targetIds: z.array(z.string().min(1)).min(1).max(5000) }).strict(),
  z.object({ preset: CampaignPreset }).strict(),
]);
export type CampaignSelection = z.infer<typeof CampaignSelection>;

export const CampaignBody = z.object({
  selection: CampaignSelection,
  rights: RequestRights,
});
export type CampaignBody = z.infer<typeof CampaignBody>;

export const TargetOutcomeKind = z.enum(["request_created", "scan_started", "skipped"]);
export type TargetOutcomeKind = z.infer<typeof TargetOutcomeKind>;

/**
 * Why a target was left out of a campaign.
 * - `already_active`: a request for it is already in motion.
 * - `no_contact_method`: no email address and no form to send it through.
 * - `scan_in_progress`: a scan for it is already running.
 * - `no_mailbox`: it needs an email and the profile has no mailbox connected.
 * - `already_confirmed`: it confirmed a removal, and nothing is re-sent unless a re-scan finds the person again.
 * - `unsupported_channel`: it only takes postal mail, fax, a phone call, or payment.
 * - `missing_profile_details`: a scan needs a name or address detail the profile does not have yet.
 * - `covered_by_platform`: a state platform such as California's DROP already handles this registered broker.
 */
export const SkipReason = z.enum([
  "already_active",
  "no_contact_method",
  "scan_in_progress",
  "no_mailbox",
  "already_confirmed",
  "unsupported_channel",
  "missing_profile_details",
  "covered_by_platform",
]);
export type SkipReason = z.infer<typeof SkipReason>;

/** What happened, or for a preview what would happen, to one target. */
export const TargetOutcome = z.object({
  targetId: z.string(),
  targetName: z.string(),
  outcome: TargetOutcomeKind,
  requestId: z.string().nullable(),
  scanId: z.string().nullable(),
  reason: SkipReason.nullable(),
  /**
   * A sentence for a person to read when the reason alone is not enough, such as which platform covers it.
   * On a target that goes ahead it is an advisory, such as a platform that can delete more than the request.
   */
  detail: z.string().nullable(),
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
