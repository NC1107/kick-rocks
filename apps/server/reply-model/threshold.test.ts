import { describe, expect, it } from "vitest";
import { type Answer, accuracyOf, atThreshold, chooseThreshold } from "./threshold.js";

function answers(spec: Array<[number, boolean]>): Answer[] {
  return spec.map(([confidence, right]) => ({
    truth: "completed",
    label: right ? "completed" : "rejected",
    confidence,
  }));
}

describe("choosing the threshold", () => {
  it("is the lowest confidence whose answers keep the target precision", () => {
    const rows = answers([
      [0.99, true],
      [0.98, true],
      [0.97, true],
      [0.96, true],
      [0.9, false],
      [0.8, true],
    ]);
    expect(chooseThreshold(rows, 0.95, 4)).toEqual({
      threshold: 0.96,
      answers: 4,
      correct: 4,
      precision: 1,
    });
  });

  it("goes lower while precision holds", () => {
    const rows = answers([
      ...Array.from({ length: 19 }, (_, i): [number, boolean] => [0.99 - i * 0.001, true]),
      [0.9, true],
      [0.5, false],
      [0.5, false],
    ]);
    expect(chooseThreshold(rows, 0.95, 5)?.threshold).toBe(0.9);
  });

  it("will not trust a handful of answers", () => {
    const rows = answers([
      [0.99, true],
      [0.98, true],
    ]);
    expect(chooseThreshold(rows, 0.95, 30)).toBeNull();
  });

  it("gives nothing when no threshold reaches the target", () => {
    const rows = answers([
      [0.99, false],
      [0.98, false],
      [0.97, true],
    ]);
    expect(chooseThreshold(rows, 0.95, 1)).toBeNull();
  });
});

describe("measuring at a threshold", () => {
  it("counts only the answers at or above it, with an interval", () => {
    const rows = answers([
      [0.99, true],
      [0.97, true],
      [0.96, false],
      [0.5, false],
    ]);
    const found = atThreshold(rows, 0.96);
    expect(found).toMatchObject({ answers: 3, correct: 2 });
    expect(found.precision).toBeCloseTo(2 / 3);
    expect(found.low).toBeLessThan(found.precision as number);
    expect(found.high).toBeGreaterThan(found.precision as number);
  });

  it("says nothing when no answer is that sure", () => {
    expect(atThreshold(answers([[0.5, true]]), 0.9)).toEqual({
      answers: 0,
      correct: 0,
      precision: null,
      low: null,
      high: null,
    });
  });

  it("reports accuracy over all answers", () => {
    expect(
      accuracyOf(
        answers([
          [0.9, true],
          [0.5, false],
        ]),
      ),
    ).toBe(0.5);
    expect(accuracyOf([])).toBe(0);
  });
});
