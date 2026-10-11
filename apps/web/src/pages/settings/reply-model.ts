import type { ReplyModelCheck, ReplyModelView } from "@kickrocks/shared";

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** One short line for what state the model is in. */
export function stateText(status: ReplyModelView["status"]): string {
  if (status.state === "not_installed") return "Not installed";
  if (status.state === "failed") return `Failed: ${status.reason ?? "unknown reason"}`;
  const loaded = status.version ? `Loaded, version ${status.version}` : "Loaded";
  return status.reason ? `${loaded}. Skipped the last reply: ${status.reason}` : loaded;
}

export function thresholdText(view: ReplyModelView): string {
  if (view.paused) return "Paused";
  if (view.threshold === null) return "Not applying";
  return `${(view.threshold * 100).toFixed(1)}% or more`;
}

/** What the spot checks say so far, with the interval that tells how far to trust it. */
export function precisionText(check: ReplyModelCheck): string {
  if (check.spotChecks === 0) return "None answered yet";
  const counts = `${check.agreed} of ${check.spotChecks}`;
  if (check.spotChecks < check.needed) return `${counts}, ${check.needed} needed to judge`;
  if (check.precision === null || check.low === null || check.high === null) return counts;
  return `${counts} (${percent(check.precision)}), likely ${percent(check.low)} to ${percent(check.high)}`;
}

export function bandText(band: ReplyModelCheck["bands"][number]): {
  range: string;
  agreed: string;
} {
  return {
    range: `${percent(band.from)} to ${percent(band.to)}`,
    agreed: band.answers === 0 ? "none" : `${band.accepted} of ${band.answers} agreed`,
  };
}
