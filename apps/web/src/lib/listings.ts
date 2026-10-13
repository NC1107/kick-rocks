import { LISTING_GROUPS, type ListingSite, type ListingStatus } from "@kickrocks/shared";
import type { StatusMeta } from "./status.js";

/**
 * How each place a site can stand reads: a shape and a word, never color alone. Typed over every
 * status, so a new one cannot ship without its words.
 */
export const LISTING_STATUS_META: Record<ListingStatus, StatusMeta> = {
  not_scanned: {
    label: "Not checked yet",
    family: "closed",
    shape: "dashed-ring",
    description: "This site has not been searched for you yet.",
  },
  waiting: {
    label: "Scan scheduled",
    family: "progress",
    shape: "ring",
    description: "A scan is queued and waiting its turn.",
  },
  scanning: {
    label: "Scanning",
    family: "progress",
    shape: "running",
    description: "A scan is running now.",
  },
  to_confirm: {
    label: "Is this you?",
    family: "needs",
    shape: "triangle",
    description: "The scan found records that may be you.",
  },
  needs_check: {
    label: "Needs you",
    family: "needs",
    shape: "triangle",
    description: "A scan stopped for something only you can do.",
  },
  removal_stalled: {
    label: "Stuck",
    family: "needs",
    shape: "triangle",
    description: "A removal was refused, bounced, got no reply or was cancelled.",
  },
  yours: {
    label: "Being removed",
    family: "progress",
    shape: "ring-dot",
    description: "You confirmed a record and its removal is under way.",
  },
  claimed_removed: {
    label: "Said removed",
    family: "progress",
    shape: "ring-dot",
    description: "The site says your record is gone. A later scan will check.",
  },
  removed: {
    label: "Removed",
    family: "resolved",
    shape: "disc",
    description: "A later scan no longer found your record.",
  },
  relisted: {
    label: "Listed again",
    family: "needs",
    shape: "triangle",
    description: "A removed record came back, so its removal was opened again.",
  },
  not_you: {
    label: "Not you",
    family: "closed",
    shape: "dash",
    description: "Every record found was marked as not you.",
  },
  not_found: {
    label: "Not listed",
    family: "resolved",
    shape: "disc",
    description: "The site showed no records for you.",
  },
  unclear: {
    label: "Unclear",
    family: "progress",
    shape: "dashed-ring",
    description: "The page showed nothing, which can also be a blocked search.",
  },
  failed: {
    label: "Scan failed",
    family: "failed",
    shape: "square",
    description: "The last scan could not finish.",
  },
  paused: {
    label: "Paused",
    family: "closed",
    shape: "dash",
    description: "You paused scanning this site.",
  },
  skipped: {
    label: "Skipped",
    family: "closed",
    shape: "dash",
    description: "You skipped this site, so it is left out of scans.",
  },
};

export type ChipId =
  | "needs_you"
  | "yours"
  | "removed"
  | "not_found"
  | "waiting"
  | "not_scanned"
  | "paused";

export const LISTING_CHIPS: readonly {
  id: ChipId;
  label: string;
  statuses: readonly ListingStatus[];
}[] = [
  { id: "needs_you", label: "Needs you", statuses: LISTING_GROUPS.needs_you },
  { id: "yours", label: "In progress", statuses: ["yours", "relisted"] },
  { id: "removed", label: "Removed", statuses: ["removed"] },
  { id: "not_found", label: "Not listed", statuses: ["not_found", "not_you", "unclear"] },
  { id: "waiting", label: "Scanning", statuses: ["waiting", "scanning"] },
  { id: "not_scanned", label: "Not checked yet", statuses: ["not_scanned"] },
  { id: "paused", label: "Paused or skipped", statuses: ["paused", "skipped"] },
];

export function chipCount(
  counts: Readonly<Partial<Record<ListingStatus, number>>>,
  statuses: readonly ListingStatus[],
): number {
  return statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
}

export const pendingRecords = (site: ListingSite) =>
  site.records.filter((record) => record.decision === "pending");

/** The first chip with something in it, so the page opens on what matters. */
export function firstBusyChip(counts: Readonly<Partial<Record<ListingStatus, number>>>): ChipId {
  return LISTING_CHIPS.find((chip) => chipCount(counts, chip.statuses) > 0)?.id ?? "needs_you";
}
