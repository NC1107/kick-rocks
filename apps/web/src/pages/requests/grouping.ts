import type { RequestStatus } from "@kickrocks/shared";
import { REQUEST_STATUS_META, type StatusFamily, type StatusShape } from "../../lib/status.js";

export type RequestSectionId = "needs" | "progress" | "done";

export const REQUEST_SECTIONS: readonly { id: RequestSectionId; label: string }[] = [
  { id: "needs", label: "Needs you" },
  { id: "progress", label: "In progress" },
  { id: "done", label: "Done" },
];

/**
 * Where a request sits for the person, read from its state family so a status added later lands in
 * the right section without being listed here. Bounced and rejected need a decision too.
 */
export function sectionOf(status: RequestStatus): RequestSectionId {
  switch (REQUEST_STATUS_META[status].family) {
    case "needs":
    case "failed":
      return "needs";
    case "progress":
      return "progress";
    case "resolved":
    case "closed":
      return "done";
  }
}

/** The non-empty sections in a fixed order, each keeping the order the requests came in. */
export function groupRequests<T extends { status: RequestStatus }>(items: readonly T[]) {
  return REQUEST_SECTIONS.map((section) => ({
    ...section,
    items: items.filter((item) => sectionOf(item.status) === section.id),
  })).filter((section) => section.items.length > 0);
}

/**
 * The list uses the four shapes of the four state families and nothing else: a ring for waiting
 * and for closed, a disc for resolved, a triangle for needs you, a square for failed.
 */
export function familyShape(family: StatusFamily): StatusShape {
  switch (family) {
    case "resolved":
      return "disc";
    case "needs":
      return "triangle";
    case "failed":
      return "square";
    case "progress":
    case "closed":
      return "ring";
  }
}

export const listShape = (status: RequestStatus): StatusShape =>
  familyShape(REQUEST_STATUS_META[status].family);
