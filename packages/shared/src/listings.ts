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
  "needs_check",
  "yours",
  "claimed_removed",
  "removed",
  "removal_stalled",
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
  needs_you: ["to_confirm", "needs_check", "removal_stalled", "failed"],
  yours: ["yours", "relisted"],
  removed: ["claimed_removed", "removed"],
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

/** The headline numbers for one profile's sites, from per-status counts so every screen agrees. */
export interface ListingRollup {
  /** Sites that hold a record of the person, whatever has happened to it since. */
  listed: number;
  /** Sites waiting on the person: a record to confirm, a stuck removal or a stopped scan. */
  toConfirm: number;
  inProgress: number;
  gone: number;
  notListed: number;
}

export function listingRollup(
  counts: Readonly<Partial<Record<ListingStatus, number>>>,
): ListingRollup {
  const sum = (statuses: readonly ListingStatus[]) =>
    statuses.reduce((total, status) => total + (counts[status] ?? 0), 0);
  return {
    listed: sum([
      "to_confirm",
      "removal_stalled",
      "yours",
      "relisted",
      "claimed_removed",
      "removed",
    ]),
    toConfirm: sum(LISTING_GROUPS.needs_you),
    inProgress: sum(["yours", "relisted", "claimed_removed"]),
    gone: sum(["removed"]),
    notListed: sum(["not_found", "not_you", "unclear"]),
  };
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
  /** False means this site is rescanned only when the person asks. */
  autoRescan: z.boolean(),
  includePastAddresses: z.boolean(),
});
export type ScanPreference = z.infer<typeof ScanPreference>;

export const DEFAULT_SCAN_PREFERENCE: ScanPreference = {
  mode: "auto",
  pausedUntil: null,
  rescanDays: null,
  autoRescan: true,
  includePastAddresses: false,
};

export const ScanPreferenceBody = z.object({
  mode: ScanMode,
  pausedUntil: z.iso.date().nullable().optional(),
  rescanDays: RescanDays.nullable().optional(),
  autoRescan: z.boolean().optional(),
  includePastAddresses: z.boolean().optional(),
});
export type ScanPreferenceBody = z.infer<typeof ScanPreferenceBody>;

export const ListingRequest = z.object({
  id: z.string(),
  status: RequestStatus,
  reference: Reference,
  /** When the request last changed, which for a confirmed removal is when it was confirmed. */
  updatedAt: z.iso.datetime(),
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

/** Why scanning leaves a site alone on a day (YYYY-MM-DD), or null when it may go ahead. */
export function preferenceBlocks(
  preference: ScanPreference,
  today: string,
): "site_paused" | "site_skipped" | null {
  if (preference.mode === "skipped") return "site_skipped";
  if (preference.mode === "paused") {
    return preference.pausedUntil === null || today < preference.pausedUntil ? "site_paused" : null;
  }
  return null;
}

/** Removals that ended without the record going, so the person has to decide what happens next. */
export const STALLED_REMOVALS: ReadonlySet<RequestStatus> = new Set([
  "rejected",
  "bounced",
  "no_response",
  "cancelled",
]);

/** What a scan row says about a site, newest scan first. */
export interface ListingScanFacts {
  taskStatus: string | null;
  finishedAt: string | null;
  error: string | null;
  noResultsShown: boolean;
}

/**
 * Where one site stands, from what is already stored. A choice the person made comes first, then
 * what needs their answer, then what the removals say, then work in flight, and last what the
 * newest finished scan found. A removal outranks a scan in flight because a routine rescan should
 * not hide that a record is being removed or is gone. A scan withdrawn by a pause or skip never searched, so it says
 * nothing about whether the person is listed.
 */
export function deriveListingStatus(input: {
  preference: ScanPreference;
  today: string;
  scans: readonly ListingScanFacts[];
  records: readonly Pick<ListingRecord, "decision" | "request" | "verifiedGoneAt">[];
  /** A removal that finished was followed by the record appearing again, and one is open again. */
  relisted: boolean;
}): ListingStatus {
  const { preference, today, records } = input;
  if (preference.mode === "skipped") return "skipped";
  if (records.some((record) => record.decision === "pending")) return "to_confirm";
  if (preferenceBlocks(preference, today) === "site_paused") return "paused";

  const mine = records.filter((record) => record.decision === "mine");
  if (mine.length > 0) {
    const requests = mine.flatMap((record) => (record.request ? [record.request] : []));
    if (input.relisted) return "relisted";
    if (requests.some((request) => STALLED_REMOVALS.has(request.status))) return "removal_stalled";
    const allSettled =
      requests.length > 0 &&
      requests.every((request) => request.status === "confirmed" || request.status === "no_record");
    if (!allSettled) return "yours";
    // A settled removal is only the broker's word until a later scan no longer finds the record.
    return mine.every((record) => record.verifiedGoneAt !== null) ? "removed" : "claimed_removed";
  }

  const latest = input.scans[0];
  if (latest?.taskStatus === "blocked") return "needs_check";
  if (latest?.taskStatus === "queued") return "waiting";
  if (latest && latest.taskStatus === "leased") return "scanning";

  const finished = input.scans.find(
    (scan) => scan.finishedAt !== null && scan.taskStatus !== "cancelled",
  );
  if (!finished) return "not_scanned";
  if (finished.error !== null) return "failed";
  if (records.length > 0) return "not_you";
  return finished.noResultsShown ? "not_found" : "unclear";
}
