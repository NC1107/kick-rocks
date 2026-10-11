import {
  accuracy,
  applyThreshold,
  type ClassStats,
  confusionPairs,
  expectedCalibrationError,
  type Gate,
  macroF1,
  perClass,
  percentile,
  type ReliabilityBin,
  reliability,
  type Scored,
  thresholdForPrecision,
} from "./metrics.js";
import type { Item, Outcome } from "./types.js";

/** The confidence the bench reports a model gate at. The product applies no model answer. */
const MODEL_REPORT_FLOOR = 0.9;

export interface LatencySummary {
  p50Ms: number | null;
  p95Ms: number | null;
  /** The same percentiles over only the replies the model was called for. */
  modelP50Ms: number | null;
  modelP95Ms: number | null;
}

export interface SplitEvaluation {
  count: number;
  accuracy: number;
  macroF1: number;
  ece: number;
  perClass: ClassStats[];
  reliability: ReliabilityBin[];
  confusions: { truth: string; label: string; count: number }[];
  /** Accuracy by where the replies came from, since mixed-inbox mail the poll would drop counts as unrelated. */
  perSource: Record<string, { count: number; accuracy: number }>;
  /** The share of replies the rules decided without the model. */
  rulesShare: number;
  /** The gate that keeps 95 percent precision, chosen on this split's own confidences. */
  ownGate: Gate | null;
  /**
   * Only the replies the model answered, at the confidence the server applies model answers at.
   * The other gates mix in rules answers, which the server applies at a lower confidence.
   */
  modelGate: Gate | null;
  latency: LatencySummary;
}

export interface HeldoutEvaluation extends SplitEvaluation {
  /** The threshold chosen on dev applied here, which is the honest figure. */
  devGate: Gate | null;
}

export function scoredOf(items: readonly Item[], outcomes: readonly Outcome[]): Scored[] {
  return items.map((item, index) => {
    const outcome = outcomes[index];
    if (!outcome) throw new Error(`No outcome for ${item.id}`);
    return { truth: item.truth, label: outcome.label, confidence: outcome.confidence };
  });
}

export function latencyOf(outcomes: readonly Outcome[]): LatencySummary {
  const all = outcomes.map((outcome) => outcome.latencyMs);
  const model = outcomes
    .map((outcome) => outcome.modelLatencyMs)
    .filter((value): value is number => value !== null);
  return {
    p50Ms: percentile(all, 0.5),
    p95Ms: percentile(all, 0.95),
    modelP50Ms: percentile(model, 0.5),
    modelP95Ms: percentile(model, 0.95),
  };
}

function perSource(
  items: readonly Item[],
  rows: readonly Scored[],
): Record<string, { count: number; accuracy: number }> {
  const result: Record<string, { count: number; accuracy: number }> = {};
  for (const source of new Set(items.map((item) => item.source))) {
    const own = rows.filter((_, index) => items[index]?.source === source);
    result[source] = { count: own.length, accuracy: accuracy(own) };
  }
  return result;
}

function modelGateOf(
  items: readonly Item[],
  outcomes: readonly Outcome[],
  threshold: number,
): Gate | null {
  const rows = scoredOf(items, outcomes).filter((_, index) => outcomes[index]?.via === "model");
  return rows.length === 0 ? null : applyThreshold(rows, threshold);
}

export function evaluateSplit(
  items: readonly Item[],
  outcomes: readonly Outcome[],
  modelThreshold: number = MODEL_REPORT_FLOOR,
): SplitEvaluation {
  const rows = scoredOf(items, outcomes);
  const stats = perClass(rows);
  return {
    count: rows.length,
    accuracy: accuracy(rows),
    macroF1: macroF1(stats),
    ece: expectedCalibrationError(rows),
    perClass: stats,
    reliability: reliability(rows),
    confusions: confusionPairs(rows).slice(0, 8),
    rulesShare:
      outcomes.length === 0
        ? 0
        : outcomes.filter((outcome) => outcome.via === "rules").length / outcomes.length,
    perSource: perSource(items, rows),
    ownGate: thresholdForPrecision(rows),
    modelGate: modelGateOf(items, outcomes, modelThreshold),
    latency: latencyOf(outcomes),
  };
}

export function evaluateHeldout(
  items: readonly Item[],
  outcomes: readonly Outcome[],
  devGate: Gate | null,
): HeldoutEvaluation {
  const base = evaluateSplit(items, outcomes);
  return {
    ...base,
    devGate: devGate ? applyThreshold(scoredOf(items, outcomes), devGate.threshold) : null,
  };
}

export function devGateOf(items: readonly Item[], outcomes: readonly Outcome[]): Gate | null {
  return thresholdForPrecision(scoredOf(items, outcomes));
}
