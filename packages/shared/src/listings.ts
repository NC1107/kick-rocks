import { z } from "zod";
import { Reference } from "./mail.js";
import { RequestStatus } from "./requests.js";
import { Match, ScanHold } from "./scans.js";
import { TaskStatus } from "./tasks.js";

/**
 * Where one site stands for one profile, worked out from the scans, matches and requests already
 * stored. `paused` and `skipped` are the only states that come from a choice the person made.
 */
export const ListingStatus = z.enum([
  "not_scanned",
  "waiting",
  "scanning",
  "to_confirm",
  "yours",
  "removed",
  "relisted",
  "not_you",
  "not_found",
  "unclear",
  "failed",
  "paused",
  "skipped",
]);
export type ListingStatus = z.infer<typeof ListingStatus>;

/** The filter chips of the listings view, each a set of statuses so no site is in two. */
export const ListingGroup = z.enum([
  "needs_you",
  "yours",
  "removed",
  "not_found",
  "waiting",
  "not_scanned",
  "paused",
  "skipped",
]);
export type ListingGroup = z.infer<typeof ListingGroup>;

export const LISTING_GROUPS: Record<ListingGroup, readonly ListingStatus[]> = {
  needs_you: ["to_confirm", "failed"],
  yours: ["yours", "relisted"],
  removed: ["removed"],
  not_found: ["not_found", "not_you", "unclear"],
  waiting: ["waiting", "scanning"],
  not_scanned: ["not_scanned"],
  paused: ["paused"],
  skipped: ["skipped"],
};

export function listingGroupOf(status: ListingStatus): ListingGroup {
  const found = ListingGroup.options.find((group) => LISTING_GROUPS[group].includes(status));
  return found ?? "not_scanned";
}

export const ScanMode = z.enum(["auto", "paused", "skipped"]);
export type ScanMode = z.infer<typeof ScanMode>;

/** The shortest cadence is a month, so a preference can never become a tight loop against a site. */
export const RESCAN_CHOICES = [30, 60, 90, 180] as const;
export const RescanDays = z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(180)]);
export type RescanDays = z.infer<typeof RescanDays>;

export const ScanPreference = z.object({
  mode: ScanMode,
  /** Null while paused means until the person resumes. */
  pausedUntil: z.iso.date().nullable(),
  /** Null means the global setting. */
  rescanDays: z.number().int().min(30).max(365).nullable(),
  includePastAddresses: z.boolean(),
});
export type ScanPreference = z.infer<typeof ScanPreference>;

export const DEFAULT_SCAN_PREFERENCE: ScanPreference = {
  mode: "auto",
  pausedUntil: null,
  rescanDays: null,
  includePastAddresses: false,
};

export const ScanPreferenceBody = z.object({
  mode: ScanMode,
  pausedUntil: z.iso.date().nullable().optional(),
  rescanDays: RescanDays.nullable().optional(),
  includePastAddresses: z.boolean().optional(),
});
export type ScanPreferenceBody = z.infer<typeof ScanPreferenceBody>;

export const ListingRequest = z.object({
  id: z.string(),
  status: RequestStatus,
  reference: Reference,
});
export type ListingRequest = z.infer<typeof ListingRequest>;

export const ListingRecord = Match.extend({ request: ListingRequest.nullable() });
export type ListingRecord = z.infer<typeof ListingRecord>;

export const ListingScan = z.object({
  id: z.string(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  candidateCount: z.number().int().nonnegative(),
  noResultsShown: z.boolean(),
  error: z.string().nullable(),
  taskStatus: TaskStatus.nullable(),
  hold: ScanHold.nullable(),
});
export type ListingScan = z.infer<typeof ListingScan>;

export const ListingReadiness = z.object({
  state: z.enum(["ready", "needs_details", "no_recipe", "recipe_review"]),
  /** What the profile lacks, in its own terms, when the state is needs_details. */
  missing: z.string().nullable(),
});
export type ListingReadiness = z.infer<typeof ListingReadiness>;

export const ListingSite = z.object({
  targetId: z.string(),
  targetName: z.string(),
  domain: z.string(),
  status: ListingStatus,
  latestScan: ListingScan.nullable(),
  records: z.array(ListingRecord),
  readiness: ListingReadiness,
  preference: ScanPreference,
  nextRescanAt: z.iso.datetime().nullable(),
});
export type ListingSite = z.infer<typeof ListingSite>;

export const ListingCounts = z.record(ListingStatus, z.number().int().nonnegative());
export type ListingCounts = z.infer<typeof ListingCounts>;

export const ListingsSummary = z.object({
  counts: ListingCounts,
  lastScanAt: z.iso.datetime().nullable(),
  nextRescanAt: z.iso.datetime().nullable(),
});
export type ListingsSummary = z.infer<typeof ListingsSummary>;

const statusList = z
  .string()
  .transform((text) => text.split(",").filter(Boolean))
  .pipe(z.array(ListingStatus));

export const ListingsQuery = z.object({
  /** Comma-separated statuses to keep. */
  status: statusList.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListingsQuery = z.infer<typeof ListingsQuery>;

export const ListingsResponse = ListingsSummary.extend({
  items: z.array(ListingSite),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type ListingsResponse = z.infer<typeof ListingsResponse>;

export const ListingDetail = ListingSite.extend({
  /** The last ten scans of this site for this profile, newest first. */
  history: z.array(
    z.object({
      id: z.string(),
      startedAt: z.iso.datetime(),
      finishedAt: z.iso.datetime().nullable(),
      candidateCount: z.number().int().nonnegative(),
      error: z.string().nullable(),
      taskStatus: TaskStatus.nullable(),
      hold: ScanHold.nullable(),
    }),
  ),
});
export type ListingDetail = z.infer<typeof ListingDetail>;

export const ListingParams = z.object({ id: z.string().min(1), targetId: z.string().min(1) });
