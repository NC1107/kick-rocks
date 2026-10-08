import { hasGeneratedDataset } from "@kickrocks/brokers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { datasetSources } from "../services.js";
import { createTestContext, type TestContext } from "../test-utils/index.js";

/**
 * Runs the classifier over the real generated dataset with the bundled recipes as they ship, so a
 * dataset or recipe change that empties the easy batch shows up here instead of in the UI.
 */
describe.skipIf(!hasGeneratedDataset())("difficulty of the bundled dataset", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({ targetSources: datasetSources() });
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("puts every live target in exactly one difficulty, with a reason for each", () => {
    const rows = ctx.services.targets.select({});
    const assessments = ctx.services.targets.assess(rows);
    const counts = { easy: 0, medium: 0, hard: 0 };
    for (const row of rows) {
      const assessment = assessments.get(row.id);
      expect(assessment?.reasons.length, row.id).toBeGreaterThan(0);
      counts[assessment?.difficulty ?? "hard"] += 1;
    }
    expect(counts.easy + counts.medium + counts.hard).toBe(rows.length);
    expect(counts.easy).toBeGreaterThan(0);
    expect(counts.hard).toBeGreaterThan(0);
    console.info(`difficulty counts: ${JSON.stringify({ total: rows.length, ...counts })}`);
  });

  it("never calls a people-search site easy", () => {
    const rows = ctx.services.targets.select({ category: "people-search" });
    for (const summary of ctx.services.targets.toSummaries(rows)) {
      expect(summary.difficulty, summary.id).not.toBe("easy");
    }
  });
});
