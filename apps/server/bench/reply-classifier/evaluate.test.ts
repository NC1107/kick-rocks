import { describe, expect, it } from "vitest";
import { evaluateSplit } from "./evaluate.js";
import type { Item, Outcome } from "./types.js";

function item(id: string, truth: Item["truth"]): Item {
  return {
    id,
    source: "tuning",
    split: "heldout",
    truth,
    subject: "",
    body: "",
    fromAddress: "a@b.test",
    raw: null,
  };
}

function outcome(label: Outcome["label"], confidence: number, via: Outcome["via"]): Outcome {
  return { label, confidence, via, latencyMs: 1, modelLatencyMs: via === "model" ? 1 : null };
}

describe("the model's own gate", () => {
  it("counts only the model's answers at the confidence the server applies them at", () => {
    const items = [
      item("1", "completed"),
      item("2", "completed"),
      item("3", "rejected"),
      item("4", "completed"),
      item("5", "completed"),
    ];
    const outcomes = [
      outcome("completed", 0.95, "model"),
      outcome("rejected", 0.93, "model"),
      outcome("rejected", 0.7, "model"),
      outcome("completed", 0.99, "rules"),
      outcome("rejected", 0.99, "rules"),
    ];
    expect(evaluateSplit(items, outcomes).modelGate).toEqual({
      threshold: 0.9,
      accepted: 2,
      below: 1,
      accuracy: 0.5,
    });
  });

  it("is empty when the model answered nothing", () => {
    expect(
      evaluateSplit([item("1", "completed")], [outcome("completed", 0.99, "rules")]).modelGate,
    ).toBeNull();
  });
});
