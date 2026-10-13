import type { CampaignSummary } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { formatShortDate } from "../../lib/format.js";
import { batchLabel, batchSummary, groupByBatch } from "./batches.js";

const batch = (overrides: Partial<CampaignSummary> = {}): CampaignSummary => ({
  id: "c1",
  createdAt: "2026-09-16T10:00:00.000Z",
  rights: ["opt_out", "delete"],
  requestCount: 30,
  counts: {},
  ...overrides,
});

describe("a batch's label and summary", () => {
  it("names the day, what was asked and how many sites", () => {
    expect(batchLabel(batch())).toBe(
      `${formatShortDate("2026-09-16T10:00:00.000Z")} · stop selling + delete · 30 sites`,
    );
    expect(batchLabel(batch({ rights: ["delete"], requestCount: 1 }))).toContain("delete · 1 site");
  });

  it("counts what went out, what was confirmed and what needs a look", () => {
    const summary = batchSummary(
      batch({
        requestCount: 16,
        counts: { queued: 2, awaiting_reply: 8, confirmed: 4, bounced: 1, no_response: 1 },
      }),
    );
    expect(summary).toBe("14 sent · 4 confirmed · 2 need a look");
  });

  it("leaves out a part that is zero and says need or needs", () => {
    expect(batchSummary(batch({ requestCount: 3, counts: { queued: 3 } }))).toBe("");
    expect(batchSummary(batch({ requestCount: 2, counts: { sent: 1, rejected: 1 } }))).toBe(
      "2 sent · 1 needs a look",
    );
  });
});

describe("grouping the listed requests by batch", () => {
  const items = [
    { id: "a", campaignId: "c1" },
    { id: "b", campaignId: null },
    { id: "c", campaignId: "c2" },
    { id: "d", campaignId: "gone" },
  ];

  it("keeps the batches' order, drops a batch with nothing listed, and gathers the rest last", () => {
    const sections = groupByBatch(items, [batch({ id: "c2" }), batch({ id: "c3" }), batch()]);
    expect(sections.map((section) => [section.id, section.items.map((item) => item.id)])).toEqual([
      ["c2", ["c"]],
      ["c1", ["a"]],
      ["single", ["b", "d"]],
    ]);
  });

  it("has no last section when every request belongs to a known batch", () => {
    expect(groupByBatch([items[0] as (typeof items)[number]], [batch()]).map((s) => s.id)).toEqual([
      "c1",
    ]);
  });
});
