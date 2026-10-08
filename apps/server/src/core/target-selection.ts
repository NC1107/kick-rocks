import type { TargetRow } from "@kickrocks/db";
import { MAX_SELECTED_TARGETS, type TargetFilter } from "@kickrocks/shared";
import { AppError } from "./errors.js";
import type { TargetsService } from "./targets.js";

/**
 * The live targets a filter selects for a campaign or a scan. A filter that matches more than one
 * request may carry is refused whole rather than cut short, so "select all" never silently drops
 * the tail of a list.
 */
export function selectByFilter(targets: TargetsService, filter: TargetFilter): TargetRow[] {
  const rows = targets.select(filter);
  if (rows.length > MAX_SELECTED_TARGETS) {
    throw new AppError(
      422,
      "selection_too_large",
      `That filter matches ${rows.length} targets, and one request takes at most ${MAX_SELECTED_TARGETS}. Narrow the filter and try again.`,
    );
  }
  return rows;
}
