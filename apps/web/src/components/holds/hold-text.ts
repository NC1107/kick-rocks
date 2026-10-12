import type { Dashboard, ScanHoldGroup, ScanHoldReason } from "@kickrocks/shared";
import { pluralize } from "../../lib/format.js";

/** "07:00": the hour quiet hours end, as the server reads its own clock. */
export function formatQuietEnd(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function phrase(reason: ScanHoldReason, group: ScanHoldGroup, quietEndHour: number | null): string {
  switch (reason) {
    case "quiet_hours": {
      const until = quietEndHour === null ? "" : ` until ${formatQuietEnd(quietEndHour)}`;
      return `held by quiet hours${until}${group.serverClock ? " (server clock)" : ""}`;
    }
    case "site_cooldown":
    case "site_breaker":
      return "held while sites cool down";
    case "site_busy":
    case "site_gap":
    case "site_daily_cap":
      return "held to space out visits";
    case "hourly_cap":
    case "daily_cap":
      return "held by the pace limits";
    case "missing_fields":
      return "held for missing profile details";
    case "no_recipe":
    case "agent_required":
    case "recipe_unapproved":
      return "waiting for an agent";
  }
}

/** Holds a person can clear, as opposed to pacing the worker clears by itself. */
const FIXABLE: ReadonlySet<ScanHoldReason> = new Set([
  "missing_fields",
  "no_recipe",
  "agent_required",
  "recipe_unapproved",
]);

/** How many queued scans wait on something the person can fix, which is the only hold worth an alert. */
export function fixableHeldScans(scans: Pick<Dashboard["scans"], "byReason">): number {
  return Object.entries(scans.byReason).reduce(
    (sum, [reason, group]) =>
      FIXABLE.has(reason as ScanHoldReason) ? sum + (group?.count ?? 0) : sum,
    0,
  );
}

/**
 * Why queued scans are not running, in one line for a worker that looks idle. Null when nothing
 * is held, so the caller keeps its own words for an idle worker with nothing to do.
 */
export function describeHeldScans(
  scans: Dashboard["scans"],
  quietEndHour: number | null,
): string | null {
  const groups = Object.entries(scans.byReason).flatMap(([reason, group]) =>
    group ? [{ reason: reason as ScanHoldReason, group }] : [],
  );
  if (groups.length === 0) return null;
  const merged = new Map<string, number>();
  for (const { reason, group } of groups) {
    const words = phrase(reason, group, quietEndHour);
    merged.set(words, (merged.get(words) ?? 0) + group.count);
  }
  const parts = [...merged].map(
    ([words, count], index) =>
      `${index === 0 && merged.size === 1 ? pluralize(count, "scan") : count} ${words}`,
  );
  return parts.join(", ");
}
