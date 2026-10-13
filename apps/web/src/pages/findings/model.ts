import {
  type ListingRecord,
  type ListingSite,
  type ListingStatus,
  listingRollup,
  type MatchAssessment,
  type MatchReason,
} from "@kickrocks/shared";
import { pendingRecords } from "../../lib/listings.js";

export const FINDING_TABS = [
  { id: "needs_you", label: "Is this you?" },
  { id: "in_progress", label: "In progress" },
  { id: "gone", label: "Gone" },
  { id: "not_listed", label: "Not listed" },
  { id: "not_scanned", label: "Not checked" },
] as const;

export type FindingTab = (typeof FINDING_TABS)[number]["id"];

const TAB_OF: Record<ListingStatus, FindingTab> = {
  to_confirm: "needs_you",
  needs_check: "needs_you",
  removal_stalled: "needs_you",
  failed: "needs_you",
  yours: "in_progress",
  relisted: "in_progress",
  claimed_removed: "in_progress",
  removed: "gone",
  not_found: "not_listed",
  not_you: "not_listed",
  unclear: "not_listed",
  not_scanned: "not_scanned",
  waiting: "not_scanned",
  scanning: "not_scanned",
  paused: "not_scanned",
  skipped: "not_scanned",
};

export function tabOf(status: ListingStatus): FindingTab {
  return TAB_OF[status];
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

export interface Rollup {
  listed: number;
  counts: Record<FindingTab, number>;
}

/** The tab counts and the headline both come from listingRollup, so Home and this page agree. */
export function rollup(sites: readonly ListingSite[]): Rollup {
  const byStatus: Partial<Record<ListingStatus, number>> = {};
  for (const site of sites) byStatus[site.status] = (byStatus[site.status] ?? 0) + 1;
  const totals = listingRollup(byStatus);
  return {
    listed: totals.listed,
    counts: {
      needs_you: totals.toConfirm,
      in_progress: totals.inProgress,
      gone: totals.gone,
      not_listed: totals.notListed,
      not_scanned: sites.filter((site) => tabOf(site.status) === "not_scanned").length,
    },
  };
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

/** How well a record fits, in pieces that may wrap between them but never inside one: "likely", "name, age, city", "age off by 1". */
export function fitParts(assessment: MatchAssessment | null): string[] {
  if (!assessment) return ["not scored"];
  const matching = assessment.reasons.flatMap((reason) => forWords(reason) ?? []);
  const against = assessment.reasons.flatMap((reason) => againstWords(reason) ?? []);
  return [
    assessment.band,
    ...(matching.length > 0 ? [matching.join(", ")] : []),
    ...(against.length > 0 ? [against.join(", ")] : []),
  ];
}

/** The record as the site printed it: name, age and the first place, in one line. */
export function recordSummary(record: ListingRecord): string {
  const { fields } = record;
  const age =
    fields.age ?? (fields.ageRange ? `${fields.ageRange.low}-${fields.ageRange.high}` : null);
  return [fields.name, age, fields.locations?.[0]].filter(Boolean).join(", ");
}

export function recordHost(record: ListingRecord): string {
  return record.recordUrl.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] ?? record.recordUrl;
}
