import { type ReplyClassification, wilsonInterval } from "@kickrocks/shared";

export interface Answer {
  truth: ReplyClassification;
  label: ReplyClassification;
  confidence: number;
}

export interface Selection {
  threshold: number;
  answers: number;
  correct: number;
  precision: number;
}

export interface AtThreshold {
  answers: number;
  correct: number;
  precision: number | null;
  low: number | null;
  high: number | null;
}

/**
 * The lowest confidence at which the answers at or above it are right at least `target` of the
 * time, counting only thresholds that keep at least `minAnswers` answers. Null when none does,
 * which stops a release rather than lowering the bar.
 */
export function chooseThreshold(
  answers: readonly Answer[],
  target: number,
  minAnswers: number,
): Selection | null {
  const candidates = [...new Set(answers.map((answer) => answer.confidence))].sort((a, b) => a - b);
  for (const threshold of candidates) {
    const kept = answers.filter((answer) => answer.confidence >= threshold);
    if (kept.length < minAnswers) break;
    const correct = kept.filter((answer) => answer.label === answer.truth).length;
    if (correct / kept.length >= target) {
      return { threshold, answers: kept.length, correct, precision: correct / kept.length };
    }
  }
  return null;
}

export function atThreshold(answers: readonly Answer[], threshold: number): AtThreshold {
  const kept = answers.filter((answer) => answer.confidence >= threshold);
  const correct = kept.filter((answer) => answer.label === answer.truth).length;
  if (kept.length === 0) {
    return { answers: 0, correct: 0, precision: null, low: null, high: null };
  }
  const { low, high } = wilsonInterval(correct, kept.length);
  return { answers: kept.length, correct, precision: correct / kept.length, low, high };
}

export function accuracyOf(answers: readonly Answer[]): number {
  if (answers.length === 0) return 0;
  return answers.filter((answer) => answer.label === answer.truth).length / answers.length;
}
