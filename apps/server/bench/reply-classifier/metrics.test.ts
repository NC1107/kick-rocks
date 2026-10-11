import { describe, expect, it } from "vitest";
import {
  accuracy,
  applyThreshold,
  expectedCalibrationError,
  macroF1,
  perClass,
  percentile,
  reliability,
  type Scored,
  thresholdForPrecision,
} from "./metrics.js";

function row(truth: Scored["truth"], label: Scored["label"], confidence: number): Scored {
  return { truth, label, confidence };
}

describe("per-class precision and recall", () => {
  const rows = [
    row("completed", "completed", 0.9),
    row("completed", "rejected", 0.6),
    row("rejected", "rejected", 0.8),
    row("rejected", "rejected", 0.7),
    row("no_record", "rejected", 0.5),
  ];

  it("counts hits against what was predicted and what was true", () => {
    const stats = Object.fromEntries(perClass(rows).map((entry) => [entry.label, entry]));
    expect(stats.rejected?.precision).toBeCloseTo(2 / 4);
    expect(stats.rejected?.recall).toBeCloseTo(1);
    expect(stats.completed?.precision).toBeCloseTo(1);
    expect(stats.completed?.recall).toBeCloseTo(1 / 2);
    expect(stats.no_record?.recall).toBeCloseTo(0);
  });

  it("leaves precision empty for a class never predicted", () => {
    const stats = perClass(rows).find((entry) => entry.label === "bounce");
    expect(stats?.precision).toBeNull();
    expect(stats?.f1).toBeNull();
  });

  it("averages F1 over the classes present in the truth only", () => {
    const stats = perClass(rows);
    const f1 = Object.fromEntries(stats.map((entry) => [entry.label, entry.f1 ?? 0]));
    const expected = ((f1.completed ?? 0) + (f1.rejected ?? 0) + (f1.no_record ?? 0)) / 3;
    expect(macroF1(stats)).toBeCloseTo(expected);
    expect(accuracy(rows)).toBeCloseTo(3 / 5);
  });
});

describe("calibration", () => {
  it("is zero when confidence matches accuracy", () => {
    const rows = [
      ...Array.from({ length: 8 }, () => row("completed", "completed", 0.8)),
      ...Array.from({ length: 2 }, () => row("completed", "rejected", 0.8)),
    ];
    expect(expectedCalibrationError(rows)).toBeCloseTo(0, 5);
  });

  it("measures the gap of an overconfident model", () => {
    const rows = [row("completed", "completed", 0.95), row("completed", "rejected", 0.95)];
    expect(expectedCalibrationError(rows)).toBeCloseTo(0.45);
  });

  it("puts a confidence of exactly one in the top bin", () => {
    const bins = reliability([row("completed", "completed", 1)]);
    expect(bins[9]?.count).toBe(1);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(1);
  });
});

describe("the 95 percent gate", () => {
  const rows = [
    ...Array.from({ length: 19 }, () => row("completed", "completed", 0.9)),
    row("completed", "rejected", 0.9),
    ...Array.from({ length: 5 }, () => row("completed", "completed", 0.99)),
    row("completed", "rejected", 0.4),
    row("completed", "rejected", 0.3),
  ];

  it("picks the lowest threshold that keeps the target and counts what falls below", () => {
    const gate = thresholdForPrecision(rows, 0.95);
    expect(gate?.threshold).toBe(0.9);
    expect(gate?.accepted).toBe(25);
    expect(gate?.below).toBe(2);
    expect(gate?.accuracy).toBeCloseTo(24 / 25);
  });

  it("reports nothing when no threshold reaches the target", () => {
    expect(thresholdForPrecision([row("completed", "rejected", 0.9)], 0.95)).toBeNull();
  });

  it("applies a threshold chosen elsewhere", () => {
    const gate = applyThreshold(rows, 0.95);
    expect(gate).toMatchObject({ accepted: 5, below: 22, accuracy: 1 });
  });
});

describe("percentile", () => {
  it("returns a measured value by nearest rank", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.95)).toBe(100);
    expect(percentile([], 0.5)).toBeNull();
  });
});
