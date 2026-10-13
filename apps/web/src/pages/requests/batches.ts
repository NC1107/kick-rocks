import type { CampaignSummary, RequestRight, RequestStatus } from "@kickrocks/shared";
import { formatShortDate, pluralize } from "../../lib/format.js";
import { STATUS_GROUPS } from "../dashboard/sections.js";
import { RIGHT_TOKENS } from "./format.js";

/** Requests that are only drafted or scheduled have not gone out, and a cancelled one never will. */
const NOT_SENT: readonly RequestStatus[] = ["draft", "queued", "cancelled"];

const NEEDS_A_LOOK = STATUS_GROUPS.find((group) => group.id === "stuck")?.statuses ?? [];

const total = (counts: CampaignSummary["counts"], statuses: readonly RequestStatus[]) =>
  statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0);

/** "Oct 6 · stop selling + delete · 30 sites": the tracked label over one batch. */
export function batchLabel(batch: Pick<CampaignSummary, "createdAt" | "rights" | "requestCount">) {
  const rights = batch.rights.map((right: RequestRight) => RIGHT_TOKENS[right]).join(" + ");
  return [formatShortDate(batch.createdAt), rights, pluralize(batch.requestCount, "site")].join(
    " · ",
  );
}

/** "12 sent · 4 confirmed · 2 need a look", leaving out any part that is zero. */
export function batchSummary(batch: Pick<CampaignSummary, "counts" | "requestCount">): string {
  const sent = batch.requestCount - total(batch.counts, NOT_SENT);
  const confirmed = total(batch.counts, ["confirmed"]);
  const stuck = total(batch.counts, NEEDS_A_LOOK);
  return [
    sent > 0 ? `${sent} sent` : null,
    confirmed > 0 ? `${confirmed} confirmed` : null,
    stuck > 0 ? `${stuck} need${stuck === 1 ? "s" : ""} a look` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

export interface BatchSection<T> {
  id: string;
  label: string;
  summary: string;
  items: T[];
}

/**
 * One section per batch, newest first, holding the listed requests that came from it. Requests
 * sent one at a time, or from a batch the list does not know, share a last section.
 */
export function groupByBatch<T extends { campaignId: string | null }>(
  items: readonly T[],
  batches: readonly CampaignSummary[],
): BatchSection<T>[] {
  const sections = batches.flatMap((batch) => {
    const inBatch = items.filter((item) => item.campaignId === batch.id);
    return inBatch.length > 0
      ? [{ id: batch.id, label: batchLabel(batch), summary: batchSummary(batch), items: inBatch }]
      : [];
  });
  const known = new Set(batches.map((batch) => batch.id));
  const single = items.filter((item) => item.campaignId === null || !known.has(item.campaignId));
  return single.length > 0
    ? [...sections, { id: "single", label: "Sent one at a time", summary: "", items: single }]
    : sections;
}
