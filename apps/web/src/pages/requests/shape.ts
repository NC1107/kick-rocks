import type { RequestStatus } from "@kickrocks/shared";
import { REQUEST_STATUS_META, type StatusFamily, type StatusShape } from "../../lib/status.js";

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
