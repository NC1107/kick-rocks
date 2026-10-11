import { z } from "zod";
import { ReplyClassification } from "./mail.js";

/** Which stage of the classifier gave an answer. */
export const ReplySource = z.enum(["rules", "model", "llm"]);
export type ReplySource = z.infer<typeof ReplySource>;

/** What Review starts from for a message the machine did not settle. */
export const ReplySuggestion = z.object({
  classification: ReplyClassification,
  confidence: z.number().min(0).max(1),
  source: ReplySource,
  /** A sampled answer above the threshold, held back to measure precision, so it is never preselected. */
  spotCheck: z.boolean(),
});
export type ReplySuggestion = z.infer<typeof ReplySuggestion>;

export const ReplyModelStatus = z.object({
  state: z.enum(["loaded", "not_installed", "failed"]),
  /** Why it is not usable, for "failed", or why the last reply went without it, for "loaded". */
  reason: z.string().nullable(),
  version: z.string().nullable(),
  /** The release's own measured threshold. Informational: no model answer is applied at it. */
  threshold: z.number().nullable(),
});
export type ReplyModelStatus = z.infer<typeof ReplyModelStatus>;

const Band = z.object({
  from: z.number(),
  to: z.number(),
  answers: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
});

export const ReplyModelView = z.object({
  status: ReplyModelStatus,
  /** How often a person agreed with a model answer, by the confidence it had. */
  bands: z.array(Band),
});
export type ReplyModelView = z.infer<typeof ReplyModelView>;

/** The 95% Wilson score interval for `successes` out of `total`. */
export function wilsonInterval(successes: number, total: number): { low: number; high: number } {
  if (total === 0) return { low: 0, high: 1 };
  const z = 1.959964;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return {
    low: Math.max(0, (centre - margin) / denominator),
    high: Math.min(1, (centre + margin) / denominator),
  };
}
