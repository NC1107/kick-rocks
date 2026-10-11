import type { ReplyClassification, ReplyModelStatus } from "@kickrocks/shared";
import type { ModelInput } from "./input.js";

export interface ModelAnswer {
  label: ReplyClassification;
  confidence: number;
  probabilities: Record<ReplyClassification, number>;
  /** The model release that answered, so a stored answer says which model it came from. */
  version: string;
  /** The confidence at which this release's answers were measured to be precise enough to apply. */
  manifestThreshold: number;
}

export type ModelResult = { ok: true; answer: ModelAnswer } | { ok: false; reason: string };

/** The reply model as the classifier sees it, wherever it runs. */
export interface ReplyModelHost {
  /** Never throws: a model that cannot answer says why, and the classifier carries on without it. */
  predict(input: ModelInput): Promise<ModelResult>;
  status(): ReplyModelStatus;
  close(): Promise<void>;
}
