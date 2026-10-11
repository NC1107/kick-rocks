import type { SkipReason, TargetOutcome } from "@kickrocks/shared";
import type { ToastAction } from "../components/ui/index.js";
import { pluralize } from "./format.js";
import { SKIP_REASON_LABELS } from "./labels.js";
import { paths } from "./paths.js";

/** Each skip in the words of a count, so a person learns what happened to the scans that did not start. */
const SKIPPED_COUNT: Partial<Record<SkipReason, (count: number) => string>> = {
  scan_in_progress: (count) => `${count} already running`,
  missing_profile_details: (count) => `${count} need profile details`,
  unsupported_channel: (count) => `${count} cannot be scanned`,
  covered_by_platform: (count) => `${count} covered by a state platform`,
};

export interface ScanStartSummary {
  started: number;
  title: string;
  description: string | undefined;
  action: ToastAction | undefined;
}

/** What starting scans came to: how many began, why each of the rest did not, and where to fix it. */
export function describeScanStart(
  items: readonly TargetOutcome[],
  profileId: string,
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
  const action: ToastAction | undefined = counts.has("missing_profile_details")
    ? { to: paths.profile(profileId), label: "Add details" }
    : undefined;
  return {
    started,
    title: started > 0 ? `Started ${pluralize(started, "scan")}` : "No scans started",
    description: skipped.length > 0 ? `Held back: ${skipped.join(", ")}.` : undefined,
    action,
  };
}
