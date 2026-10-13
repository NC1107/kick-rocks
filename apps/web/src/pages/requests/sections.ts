import type { RequestStatus } from "@kickrocks/shared";
import { STATUS_GROUPS } from "../dashboard/sections.js";

/** What needs the person comes first on this page, while Home lists the groups in its own order. */
const SECTION_ORDER = ["stuck", "active", "resolved"] as const;

interface Groupable {
  status: RequestStatus;
  verifiedGoneAt?: string | null;
}

/**
 * The non-empty groups in a fixed order, each keeping the order the requests came in, except that
 * in Done the removals a scan checked come first. The groups are Home's, so a count on one page is
 * the count on the other.
 */
export function groupRequests<T extends Groupable>(items: readonly T[]) {
  return SECTION_ORDER.flatMap((id) => {
    const group = STATUS_GROUPS.find((candidate) => candidate.id === id);
    if (!group) return [];
    const inGroup = items.filter((item) => group.statuses.includes(item.status));
    const verified = inGroup.filter((item) => item.verifiedGoneAt);
    const ordered =
      id === "resolved"
        ? [...verified, ...inGroup.filter((item) => !item.verifiedGoneAt)]
        : inGroup;
    return inGroup.length > 0
      ? [{ id: group.id, label: group.title, items: ordered, verifiedGone: verified.length }]
      : [];
  });
}

/** "12 · 1 checked gone": the section count, with how many a scan has verified when any. */
export function sectionCount(total: number, verifiedGone: number): number | string {
  return verifiedGone > 0 ? `${total} · ${verifiedGone} checked gone` : total;
}
