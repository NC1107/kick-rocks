import type {
  ListingRecord,
  ListingSite,
  ListingStatus,
  MatchAssessment,
  MatchReason,
} from "@kickrocks/shared";
import { pendingRecords } from "../../lib/listings.js";

export const FINDING_TABS = [
  { id: "needs_you", label: "Needs you" },
  { id: "in_progress", label: "In progress" },
  { id: "gone", label: "Gone" },
  { id: "not_listed", label: "Not listed" },
  { id: "not_scanned", label: "Not scanned" },
] as const;

export type FindingTab = (typeof FINDING_TABS)[number]["id"];

const TAB_OF: Partial<Record<ListingStatus, FindingTab>> = {
  to_confirm: "needs_you",
  needs_check: "needs_you",
  removal_stalled: "needs_you",
  failed: "needs_you",
  removed: "gone",
  not_found: "not_listed",
  not_you: "not_listed",
  unclear: "not_listed",
  not_scanned: "not_scanned",
  paused: "not_scanned",
  skipped: "not_scanned",
};

/** A status this page has no tab for is work under way, so a new status never disappears. */
export function tabOf(status: ListingStatus): FindingTab {
  return TAB_OF[status] ?? "in_progress";
}

/** Old links used the filter ids of the per-site listing view. */
const LEGACY_SHOW: Record<string, FindingTab> = {
  needs_you: "needs_you",
  yours: "in_progress",
  waiting: "in_progress",
  removed: "gone",
  not_found: "not_listed",
  not_scanned: "not_scanned",
  paused: "not_scanned",
};

export function tabFromParam(value: string | null): FindingTab | null {
  if (value === null) return null;
  const direct = FINDING_TABS.find((tab) => tab.id === value);
  return direct?.id ?? LEGACY_SHOW[value] ?? null;
}

const FOUND: ReadonlySet<ListingStatus> = new Set([
  "to_confirm",
  "removal_stalled",
  "yours",
  "relisted",
  "removed",
]);

export interface Rollup {
  found: number;
  counts: Record<FindingTab, number>;
}

export function rollup(sites: readonly ListingSite[]): Rollup {
  const counts: Record<FindingTab, number> = {
    needs_you: 0,
    in_progress: 0,
    gone: 0,
    not_listed: 0,
    not_scanned: 0,
  };
  let found = 0;
  for (const site of sites) {
    counts[tabOf(site.status)] += 1;
    if (FOUND.has(site.status)) found += 1;
  }
  return { found, counts };
}

/** "Found on 7 sites · 4 need you · 1 in progress · 1 gone", leaving out what is zero. */
export function rollupLine({ found, counts }: Rollup): string {
  const parts = [`Found on ${found} ${found === 1 ? "site" : "sites"}`];
  if (counts.needs_you > 0) parts.push(`${counts.needs_you} need you`);
  if (counts.in_progress > 0) parts.push(`${counts.in_progress} in progress`);
  if (counts.gone > 0) parts.push(`${counts.gone} gone`);
  return parts.join(" · ");
}

export function firstBusyTab(counts: Record<FindingTab, number>): FindingTab {
  return counts.needs_you > 0 ? "needs_you" : "in_progress";
}

/** Every record waiting for an answer, across all sites, with likely ones first. */
export function pendingFindings(sites: readonly ListingSite[]): ListingRecord[] {
  return sites.flatMap(pendingRecords);
}

function gap(a: { low: number; high: number }, b: { low: number; high: number }): number {
  return Math.max(0, a.low - b.high, b.low - a.high);
}

function againstWords(reason: MatchReason): string | null {
  if (reason.weight !== "weak_against" && reason.weight !== "contradicts") return null;
  switch (reason.kind) {
    case "age": {
      const off = gap(reason.candidate, reason.profile);
      return off > 0 ? `age off by ${off}` : "age differs";
    }
    case "name":
      return reason.via === "middle" ? "middle initial differs" : "name differs";
    case "place":
      return "place differs";
    case "phone":
      return "phone differs";
    case "email":
      return "email differs";
  }
}

function forWords(reason: MatchReason): string | null {
  if (reason.weight !== "strong" && reason.weight !== "weak") return null;
  switch (reason.kind) {
    case "place":
      return reason.city ? "city" : "state";
    default:
      return reason.kind;
  }
}

/** One plain line for how well a record fits: "likely - name, phone, city match - age off by 1". */
export function fitLine(assessment: MatchAssessment | null): string {
  if (!assessment) return "not scored";
  const matching = assessment.reasons.flatMap((reason) => forWords(reason) ?? []);
  const against = assessment.reasons.flatMap((reason) => againstWords(reason) ?? []);
  return [
    assessment.band,
    matching.length > 0 ? `${matching.join(", ")} match` : null,
    ...(against.length > 0 ? [against.join(", ")] : []),
  ]
    .filter(Boolean)
    .join(" - ");
}

/** The record as the site printed it: name, age and the first place, in one line. */
export function recordSummary(record: ListingRecord): string {
  const { fields } = record;
  const age =
    fields.age ?? (fields.ageRange ? `${fields.ageRange.low}-${fields.ageRange.high}` : null);
  return [fields.name, age, fields.locations?.[0]].filter(Boolean).join(" · ");
}

export function recordHost(record: ListingRecord): string {
  return record.recordUrl.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] ?? record.recordUrl;
}
