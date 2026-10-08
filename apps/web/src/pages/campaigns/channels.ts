import {
  type CampaignPreview,
  MAX_SELECTED_TARGETS,
  type SkipReason,
  TargetFilter,
  type TargetListItem,
  type TargetOutcome,
} from "@kickrocks/shared";

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
  /** Web forms a saved recipe fills in. */
  form: number;
  /** Web forms with no working recipe, which wait for an agent or for the person. */
  manual: number;
  scan: number;
  skipped: number;
}

export type CountedTarget = Pick<TargetListItem, "needsRecord" | "contactMethod"> &
  Partial<Pick<TargetListItem, "automation">>;

/** A form the built-in worker cannot run: it has no saved steps, or the ones it has are broken. */
function needsAgentOrPerson(target: CountedTarget): boolean {
  const remove = target.automation?.remove;
  return remove === null || remove === "broken";
}

/** The row of the readout a preview outcome lands in. A target the list cannot name counts as a form. */
export function outcomeChannel(
  item: TargetOutcome,
  targets: ReadonlyMap<string, CountedTarget>,
): keyof ChannelCounts {
  if (item.outcome === "skipped") return "skipped";
  if (item.outcome === "scan_started") return "scan";
  const target = targets.get(item.targetId);
  if (target && channelOf(target) === "email") return "email";
  return target && needsAgentOrPerson(target) ? "manual" : "form";
}

/** Counts a preview by the channel each target would use. */
export function countByChannel(
  items: readonly TargetOutcome[],
  targets: ReadonlyMap<string, CountedTarget>,
): ChannelCounts {
  const counts: ChannelCounts = { email: 0, form: 0, manual: 0, scan: 0, skipped: 0 };
  for (const item of items) counts[outcomeChannel(item, targets)] += 1;
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

/** Targets that go ahead with something worth reading first, in the order they were chosen. */
export function advisories(items: CampaignPreview["items"]): TargetOutcome[] {
  return items.filter((item) => item.outcome !== "skipped" && item.detail !== null);
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
  ].slice(0, MAX_SELECTED_TARGETS);
}

/** The filter a Targets page "select all matching" link carries, or null when it is missing or not a filter. */
export function parseFilterParam(value: string | null): TargetFilter | null {
  if (!value) return null;
  try {
    const parsed = TargetFilter.strict().safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Forms that no approved recipe can fill in, so the request waits for an agent or for the person.
 * Only worth a warning when no agent worker has ever reported in, because an agent would take them.
 */
export function waitingForPerson(counts: ChannelCounts, agentSeen: boolean): number {
  return agentSeen ? 0 : counts.manual;
}
