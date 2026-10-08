import { describe, expect, it } from "vitest";
import { measureCoverage } from "./coverage-measure.js";

describe("dataset coverage", () => {
  const result = measureCoverage();

  it("has no contradiction between the dataset, the recipes and the planner that is not a judgment call", () => {
    expect(result.contradictions).toEqual([]);
  });

  it("keeps a judgment call only while the contradiction it excuses still exists", () => {
    expect(result.judgmentCalls.filter((call) => !call.matched)).toEqual([]);
  });

  it("plans every target of each fixed profile exactly once", () => {
    for (const share of Object.values(result.planner)) {
      const planned = Object.values(share.counts).reduce((sum, count) => sum + count, 0);
      expect(planned).toBe(share.total);
    }
  });
});
