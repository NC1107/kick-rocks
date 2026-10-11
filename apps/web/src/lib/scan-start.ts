import type { Dashboard, SkipReason, TargetOutcome } from "@kickrocks/shared";
import type { ToastAction, ToastIntent } from "../components/ui/index.js";
import { pluralize } from "./format.js";
import { SKIP_REASON_LABELS } from "./labels.js";
import { paths } from "./paths.js";

/** Each skip in the words of a count, so a person learns what happened to the scans that did not start. */
const SKIPPED_COUNT: Partial<Record<SkipReason, (count: number) => string>> = {
  scan_in_progress: (count) => `${count} already running`,
  missing_profile_details: (count) => `${count} need profile details`,
  unsupported_channel: (count) => `${count} cannot be scanned`,
  covered_by_platform: (count) => `${count} covered by a state platform`,
  site_paused: (count) => `${count} paused`,
  site_skipped: (count) => `${count} skipped`,
};

export interface ScanStartSummary {
  started: number;
  /** Info when nothing that started can run yet, so a green toast never hides a scan that is stuck. */
  intent: ToastIntent;
  title: string;
  description: string | undefined;
  action: ToastAction | undefined;
}

/** The reasons scans that did start still cannot run, or an empty list when some can. */
function whyNoneCanRun(scanning: Dashboard["scanning"]): string[] {
  const waitingOnQuiet = scanning.quiet ? scanning.ready : 0;
  if (scanning.ready > waitingOnQuiet) return [];
  return [
    scanning.noRecipe > 0 ? `${scanning.noRecipe} need an agent` : null,
    scanning.recipeNeedsReview > 0
      ? `${scanning.recipeNeedsReview} wait for a recipe review`
      : null,
    waitingOnQuiet > 0 ? `${waitingOnQuiet} wait for quiet hours` : null,
  ].filter((part): part is string => part !== null);
}

/**
 * What starting scans came to: how many began, why each of the rest did not, and where to fix it.
 * Given what the profile can be scanned on, it also says so when every scan that began is stuck.
 */
export function describeScanStart(
  items: readonly TargetOutcome[],
  profileId: string,
  scanning?: Dashboard["scanning"],
): ScanStartSummary {
  const started = items.filter((item) => item.outcome === "scan_started").length;
  const counts = new Map<SkipReason, number>();
  for (const item of items) {
    if (item.reason) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }
  const skipped = [...counts].map(([reason, count]) =>
    (SKIPPED_COUNT[reason] ?? ((n: number) => `${n} ${SKIP_REASON_LABELS[reason].toLowerCase()}`))(
      count,
    ),
  );
  const description = skipped.length > 0 ? `Held back: ${skipped.join(", ")}.` : undefined;
  const needsDetails = counts.has("missing_profile_details");
  const action: ToastAction | undefined = needsDetails
    ? { to: paths.profile(profileId), label: "Add details" }
    : undefined;

  if (started === 0) {
    return {
      started,
      intent: "info",
      title:
        needsDetails && scanning?.missing
          ? `No scans started. Add ${scanning.missing}`
          : "No scans started",
      description,
      action,
    };
  }
  const stuck = scanning ? whyNoneCanRun(scanning) : [];
  if (stuck.length > 0) {
    return {
      started,
      intent: "info",
      title: `Queued ${started}, none can run now: ${stuck.join(", ")}`,
      description,
      action,
    };
  }
  return {
    started,
    intent: "success",
    title: `Started ${pluralize(started, "scan")}`,
    description,
    action,
  };
}
