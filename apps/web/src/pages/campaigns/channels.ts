import type { CampaignPreview, SkipReason, TargetListItem, TargetOutcome } from "@kickrocks/shared";

/** How a target in a campaign is reached: an email, a web form, or a scan that finds the record first. */
export type CampaignChannel = "email" | "form" | "scan";

/**
 * The channel the server will pick for a target: a site that needs a record starts from a scan,
 * anything with an email address gets an email, and the rest gets a form.
 */
export function channelOf(
  target: Pick<TargetListItem, "needsRecord" | "contactMethod">,
): CampaignChannel | null {
  if (target.needsRecord) return "scan";
  if (target.contactMethod === "email" || target.contactMethod === "both") return "email";
  if (target.contactMethod === "form") return "form";
  return null;
}

export interface ChannelCounts {
  email: number;
  form: number;
  scan: number;
  skipped: number;
}

/** Counts a preview by the channel each target would use. A target the list cannot name counts as a form. */
export function countByChannel(
  items: readonly TargetOutcome[],
  targets: ReadonlyMap<string, Pick<TargetListItem, "needsRecord" | "contactMethod">>,
): ChannelCounts {
  const counts: ChannelCounts = { email: 0, form: 0, scan: 0, skipped: 0 };
  for (const item of items) {
    if (item.outcome === "skipped") counts.skipped += 1;
    else if (item.outcome === "scan_started") counts.scan += 1;
    else {
      const target = targets.get(item.targetId);
      const channel = target ? channelOf(target) : null;
      counts[channel === "email" ? "email" : "form"] += 1;
    }
  }
  return counts;
}

export interface SkipGroup {
  reason: SkipReason;
  items: TargetOutcome[];
}

/** Skipped targets grouped by why, biggest group first, so the reason that matters most leads. */
export function groupSkipped(items: CampaignPreview["items"]): SkipGroup[] {
  const groups = new Map<SkipReason, TargetOutcome[]>();
  for (const item of items) {
    if (item.outcome !== "skipped" || !item.reason) continue;
    groups.set(item.reason, [...(groups.get(item.reason) ?? []), item]);
  }
  return [...groups]
    .map(([reason, grouped]) => ({ reason, items: grouped }))
    .sort((a, b) => b.items.length - a.items.length || a.reason.localeCompare(b.reason));
}

/** The target ids a campaign link carries, with blanks and repeats dropped. */
export function parseTargetIds(value: string | null): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ].slice(0, 5000);
}
