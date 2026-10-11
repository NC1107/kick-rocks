import type { TargetOutcome } from "@kickrocks/shared";
import { pluralize } from "./format.js";

/** What starting scans came to, in one short line that also says what held the rest back. */
export function describeScanStart(items: readonly TargetOutcome[]): {
  started: number;
  text: string;
} {
  const started = items.filter((item) => item.outcome === "scan_started");
  const forAgent = started.filter((item) => item.detail !== null).length;
  const needDetails = items.filter((item) => item.reason === "missing_profile_details").length;
  const running = items.filter((item) => item.reason === "scan_in_progress").length;
  const held = [
    forAgent > 0 ? `${forAgent} wait for an agent` : null,
    needDetails > 0 ? `${needDetails} need profile details` : null,
    running > 0 ? `${running} already running` : null,
  ].filter((part): part is string => part !== null);
  const lead =
    started.length > 0 ? `Started ${pluralize(started.length, "scan")}` : "No scans started";
  return { started: started.length, text: held.length > 0 ? `${lead}: ${held.join(", ")}` : lead };
}
