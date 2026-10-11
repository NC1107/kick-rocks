import type { ReplyClassification } from "@kickrocks/shared";
import { LABELS } from "./labels.js";

export interface Scored {
  truth: ReplyClassification;
  label: ReplyClassification;
  confidence: number;
}

export interface ClassStats {
  label: ReplyClassification;
  support: number;
  predicted: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface ReliabilityBin {
  lower: number;
  upper: number;
  count: number;
  meanConfidence: number | null;
  accuracy: number | null;
}

export interface Gate {
  /** The lowest confidence a reply may have and still be acted on. */
  threshold: number;
  accepted: number;
  below: number;
  /** Accuracy among the accepted replies; null when none are accepted. */
  accuracy: number | null;
}

export const RELIABILITY_BINS = 10;
export const TARGET_PRECISION = 0.95;

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function accuracy(rows: readonly Scored[]): number {
  if (rows.length === 0) return 0;
  return rows.filter((row) => row.truth === row.label).length / rows.length;
}

export function perClass(rows: readonly Scored[]): ClassStats[] {
  return LABELS.map((label) => {
    const support = rows.filter((row) => row.truth === label).length;
    const predicted = rows.filter((row) => row.label === label).length;
    const hits = rows.filter((row) => row.truth === label && row.label === label).length;
    const precision = ratio(hits, predicted);
    const recall = ratio(hits, support);
    const f1 =
      precision === null || recall === null || precision + recall === 0
        ? precision === null && recall === null
          ? null
          : 0
        : (2 * precision * recall) / (precision + recall);
    return { label, support, predicted, precision, recall, f1 };
  });
}

/** Averaged over the classes that occur in the truth, so a class the split lacks cannot drag it down. */
export function macroF1(stats: readonly ClassStats[]): number {
  const present = stats.filter((entry) => entry.support > 0);
  if (present.length === 0) return 0;
  return present.reduce((sum, entry) => sum + (entry.f1 ?? 0), 0) / present.length;
}

export function reliability(rows: readonly Scored[]): ReliabilityBin[] {
  const bins = Array.from({ length: RELIABILITY_BINS }, (_, index) => ({
    lower: index / RELIABILITY_BINS,
    upper: (index + 1) / RELIABILITY_BINS,
    confidences: [] as number[],
    hits: 0,
  }));
  for (const row of rows) {
    const index = Math.min(RELIABILITY_BINS - 1, Math.floor(row.confidence * RELIABILITY_BINS));
    const bin = bins[Math.max(0, index)];
    if (!bin) continue;
    bin.confidences.push(row.confidence);
    if (row.truth === row.label) bin.hits += 1;
  }
  return bins.map((bin) => ({
    lower: bin.lower,
    upper: bin.upper,
    count: bin.confidences.length,
    meanConfidence: ratio(
      bin.confidences.reduce((sum, value) => sum + value, 0),
      bin.confidences.length,
    ),
    accuracy: ratio(bin.hits, bin.confidences.length),
  }));
}

/** The count-weighted gap between what the model claims and how often it is right. */
export function expectedCalibrationError(rows: readonly Scored[]): number {
  if (rows.length === 0) return 0;
  return reliability(rows).reduce((sum, bin) => {
    if (bin.count === 0 || bin.meanConfidence === null || bin.accuracy === null) return sum;
    return sum + (bin.count / rows.length) * Math.abs(bin.accuracy - bin.meanConfidence);
  }, 0);
}

export function applyThreshold(rows: readonly Scored[], threshold: number): Gate {
  const accepted = rows.filter((row) => row.confidence >= threshold);
  return {
    threshold,
    accepted: accepted.length,
    below: rows.length - accepted.length,
    accuracy: accepted.length === 0 ? null : accuracy(accepted),
  };
}

/**
 * The lowest confidence at which the replies at or above it are right at least `target` of the
 * time, which keeps the most replies automatic. Null when no threshold reaches the target.
 */
export function thresholdForPrecision(
  rows: readonly Scored[],
  target: number = TARGET_PRECISION,
): Gate | null {
  const candidates = [...new Set(rows.map((row) => row.confidence))].sort((a, b) => a - b);
  for (const threshold of candidates) {
    const gate = applyThreshold(rows, threshold);
    if (gate.accuracy !== null && gate.accuracy >= target) return gate;
  }
  return null;
}

/** Nearest-rank percentile, so the value is one that was measured. */
export function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(fraction * sorted.length)));
  return sorted[rank - 1] ?? null;
}

export function confusionPairs(
  rows: readonly Scored[],
): { truth: ReplyClassification; label: ReplyClassification; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.truth === row.label) continue;
    const key = `${row.truth}\0${row.label}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [truth, label] = key.split("\0") as [ReplyClassification, ReplyClassification];
      return { truth, label, count };
    })
    .sort((a, b) => b.count - a.count);
}
