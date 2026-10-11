import type { ReplyModelView } from "@kickrocks/shared";

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** One short line for what state the model is in. */
export function stateText(status: ReplyModelView["status"]): string {
  if (status.state === "not_installed") return "Not installed";
  if (status.state === "failed") return `Failed: ${status.reason ?? "unknown reason"}`;
  const loaded = status.version ? `Loaded, version ${status.version}` : "Loaded";
  return status.reason ? `${loaded}. Skipped the last reply: ${status.reason}` : loaded;
}

export function bandText(band: ReplyModelView["bands"][number]): {
  range: string;
  agreed: string;
} {
  return {
    range: `${percent(band.from)} to ${percent(band.to)}`,
    agreed: band.answers === 0 ? "none" : `${band.accepted} of ${band.answers} agreed`,
  };
}
