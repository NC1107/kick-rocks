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

/** The lowest confidence a model answer is ever applied at, whatever its manifest or settings say. */
export const MODEL_APPLY_FLOOR = 0.9;

export const REPLY_MODEL_SPOT_CHECK_DEFAULT_PERCENT = 10;

export const ReplyModelSettings = z.object({
  /** Share of applicable model answers sent to Review as unbiased spot checks. 0 switches them off. */
  spotCheckPercent: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(REPLY_MODEL_SPOT_CHECK_DEFAULT_PERCENT),
  /** Raises the threshold above the model's own. It can never go below the floor. */
  threshold: z.number().min(MODEL_APPLY_FLOOR).max(1).nullable().default(null),
});
export type ReplyModelSettings = z.infer<typeof ReplyModelSettings>;

/** Set by the server when spot checks show the model is not precise enough, and cleared by a person. */
export const ReplyModelState = z.object({
  pausedAt: z.iso.datetime().nullable().default(null),
  reason: z.string().nullable().default(null),
  /** Only spot checks decided after this count, so resuming does not re-trigger the same pause. */
  countedFrom: z.iso.datetime().nullable().default(null),
});
export type ReplyModelState = z.infer<typeof ReplyModelState>;

export const ReplyModelStatus = z.object({
  state: z.enum(["loaded", "not_installed", "failed"]),
  /** Why it is not usable, for "failed". */
  reason: z.string().nullable(),
  version: z.string().nullable(),
  /** The release's own threshold, before the person's setting and the floor are applied. */
  threshold: z.number().nullable(),
});
export type ReplyModelStatus = z.infer<typeof ReplyModelStatus>;

const Band = z.object({
  from: z.number(),
  to: z.number(),
  answers: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
});

export const ReplyModelCheck = z.object({
  /** Spot checks a person has answered. */
  spotChecks: z.number().int().nonnegative(),
  agreed: z.number().int().nonnegative(),
  precision: z.number().nullable(),
  /** The 95% Wilson interval of the precision. */
  low: z.number().nullable(),
  high: z.number().nullable(),
  /** The least spot checks before the server judges the model by them. */
  needed: z.number().int().positive(),
  /** How often a person agreed with a model answer, by the confidence it had. */
  bands: z.array(Band),
});
export type ReplyModelCheck = z.infer<typeof ReplyModelCheck>;

export const ReplyModelView = z.object({
  status: ReplyModelStatus,
  /** The confidence a model answer is applied at, or null while the model is unusable. */
  threshold: z.number().nullable(),
  thresholdOverride: z.number().nullable(),
  spotCheckPercent: z.number().int(),
  paused: z.object({ at: z.iso.datetime(), reason: z.string() }).nullable(),
  check: ReplyModelCheck,
});
export type ReplyModelView = z.infer<typeof ReplyModelView>;

export const ReplyModelPatch = z.object({
  spotCheckPercent: z.number().int().min(0).max(100).optional(),
  threshold: z.number().min(MODEL_APPLY_FLOOR).max(1).nullable().optional(),
  /** Starts applying model answers again after the server stopped. */
  resume: z.literal(true).optional(),
});
export type ReplyModelPatch = z.infer<typeof ReplyModelPatch>;

export const SPOT_CHECKS_NEEDED = 20;
export const PRECISION_TARGET = 0.95;

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
