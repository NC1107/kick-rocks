import { describe, expect, it } from "vitest";
import { duplicatesAcross, intakeItems, loadItems, tuningItems } from "./corpus.js";
import { LABELS } from "./labels.js";
import { runRulesOnly } from "./pipeline.js";

describe("the corpus", () => {
  it("keeps dev and held-out apart within each source", async () => {
    const dev = await loadItems("dev", ["tuning", "intake"]);
    const heldout = await loadItems("heldout", ["tuning", "intake"]);
    const devIds = new Set(dev.map((item) => item.id));
    expect(heldout.some((item) => devIds.has(item.id))).toBe(false);
    expect(new Set(dev.map((item) => item.id)).size).toBe(dev.length);
    expect(duplicatesAcross(dev, heldout).filter((id) => id.startsWith("tuning:"))).toEqual([]);
  });

  it("counts the held-out mail that repeats a dev message word for word", async () => {
    const dev = await loadItems("dev", ["intake"]);
    const heldout = await loadItems("heldout", ["intake"]);
    const repeats = duplicatesAcross(dev, heldout);
    expect(repeats.length).toBeLessThan(heldout.length / 10);
  });

  it("labels every item with a known class and covers every class somewhere", async () => {
    const all = [
      ...(await loadItems("dev", ["tuning", "intake"])),
      ...(await loadItems("heldout", ["tuning", "intake"])),
    ];
    for (const item of all) expect(LABELS).toContain(item.truth);
    for (const label of LABELS) expect(all.some((item) => item.truth === label)).toBe(true);
  });

  it("reads the mixed-inbox mail into subject and body", async () => {
    const items = await intakeItems("dev");
    expect(items.length).toBeGreaterThan(100);
    expect(items.every((item) => item.raw !== null && item.subject !== "")).toBe(true);
  });

  it("holds replies shaped like the live needs_form one in both splits", () => {
    for (const split of ["dev", "heldout"] as const) {
      const live = tuningItems(split).filter((item) => item.id.includes("live-form"));
      expect(live.length).toBeGreaterThanOrEqual(2);
      for (const item of live) {
        expect(item.truth).toBe("needs_form");
        expect(item.body.toLowerCase()).toContain("thank you for contacting");
        expect(item.body.toLowerCase()).toMatch(/form/);
        expect(item.body.toLowerCase()).toMatch(/phone|calling|toll free/);
      }
    }
  });
});

describe("the rules stage on the corpus", () => {
  it("runs every reply and never answers outside the class set", async () => {
    const items = await loadItems("dev", ["tuning"]);
    const outcomes = await runRulesOnly(items);
    expect(outcomes).toHaveLength(items.length);
    for (const outcome of outcomes) {
      expect(LABELS).toContain(outcome.label);
      expect(outcome.confidence).toBeGreaterThanOrEqual(0);
      expect(outcome.confidence).toBeLessThanOrEqual(1);
    }
  });
});
