import type { ReplyClassification } from "@kickrocks/shared";

export type Split = "dev" | "heldout";
export type Source = "tuning" | "intake";

/** One labeled message, with the raw source mail when it came from the mixed-inbox corpus. */
export interface Item {
  id: string;
  source: Source;
  split: Split;
  truth: ReplyClassification;
  subject: string;
  body: string;
  fromAddress: string;
  /** The full RFC 822 text, present for the mixed-inbox corpus. */
  raw: string | null;
}

/** What a model says about one reply. `probabilities` is null for a model that gives one number only. */
export interface ModelPrediction {
  label: ReplyClassification;
  confidence: number;
  probabilities: Partial<Record<ReplyClassification, number>> | null;
}

/** The text a model sees, which is what the rules stage leaves for it. */
export interface ModelInput {
  subject: string;
  body: string;
}

/** A model that classifies reply text. Returning null means it failed and the rules answer stands. */
export interface ReplyModel {
  predict(input: ModelInput): Promise<ModelPrediction | null>;
}

/** The final answer of a pipeline for one reply. */
export interface Outcome {
  label: ReplyClassification;
  confidence: number;
  via: "rules" | "model";
  /** Wall time of the whole pipeline for this reply. */
  latencyMs: number;
  /** Wall time of the model call alone, when it ran. */
  modelLatencyMs: number | null;
}

export interface Candidate {
  id: string;
  description: string;
  /** Where the model runs, in words, for the report. */
  hardware: string;
  /** Prepares the candidate; may train on the dev items. Throws {@link Skip} when it cannot run. */
  setup(dev: Item[]): Promise<void>;
  /** Classifies every item in order. A candidate may batch work that is not timed per reply. */
  runAll(items: Item[]): Promise<Outcome[]>;
  dispose(): Promise<void>;
}

/** Thrown by a candidate that cannot run here, so the report says why instead of failing the run. */
export class Skip extends Error {}
