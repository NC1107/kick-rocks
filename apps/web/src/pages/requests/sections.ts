import type { RequestStatus } from "@kickrocks/shared";
import { STATUS_GROUPS } from "../dashboard/sections.js";

/** What needs the person comes first on this page, while Home lists the groups in its own order. */
const SECTION_ORDER = ["stuck", "active", "resolved"] as const;

/**
 * The non-empty groups in a fixed order, each keeping the order the requests came in. The groups
 * are Home's, so a count on one page is the count on the other.
 */
export function groupRequests<T extends { status: RequestStatus }>(items: readonly T[]) {
  return SECTION_ORDER.flatMap((id) => {
    const group = STATUS_GROUPS.find((candidate) => candidate.id === id);
    if (!group) return [];
    const inGroup = items.filter((item) => group.statuses.includes(item.status));
    return inGroup.length > 0 ? [{ id: group.id, label: group.title, items: inGroup }] : [];
  });
}
