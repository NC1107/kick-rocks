import { describe, expect, it } from "vitest";
import { CONFIDENCE_THRESHOLD } from "../../src/mail/classifier.js";
import { tuningItems } from "./corpus.js";
import { runRulesFirst, runRulesOnly } from "./pipeline.js";
import type { ModelInput, ReplyModel } from "./types.js";

function countingModel(): ReplyModel & { seen: ModelInput[] } {
  const seen: ModelInput[] = [];
  return {
    seen,
    async predict(input) {
      seen.push(input);
      return { label: "unknown", confidence: 0.4, probabilities: null };
    },
  };
}

describe("rules first", () => {
  const items = tuningItems("dev");

  it("calls the model only for replies the rules leave under the threshold", async () => {
    const rules = await runRulesOnly(items);
    const model = countingModel();
    const outcomes = await runRulesFirst(items, model);
    const unsure = rules.filter((outcome) => outcome.confidence < CONFIDENCE_THRESHOLD).length;
    expect(model.seen).toHaveLength(unsure);
    expect(unsure).toBeGreaterThan(0);
    expect(unsure).toBeLessThan(items.length);
    for (const [index, outcome] of outcomes.entries()) {
      const before = rules[index];
      if (before && before.confidence >= CONFIDENCE_THRESHOLD) {
        expect(outcome).toMatchObject({ via: "rules", label: before.label });
      }
    }
  });

  it("keeps the rules answer when the model fails", async () => {
    const failing: ReplyModel = { predict: async () => null };
    const rules = await runRulesOnly(items);
    const outcomes = await runRulesFirst(items, failing);
    expect(outcomes.map((outcome) => outcome.label)).toEqual(rules.map((outcome) => outcome.label));
    expect(outcomes.every((outcome) => outcome.via === "rules")).toBe(true);
  });

  it("sends every reply to the model when asked to measure the model alone", async () => {
    const model = countingModel();
    await runRulesFirst(items, model, true);
    expect(model.seen).toHaveLength(items.length);
  });
});
