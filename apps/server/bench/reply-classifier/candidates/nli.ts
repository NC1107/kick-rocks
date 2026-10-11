import type { ReplyClassification } from "@kickrocks/shared";
import { describeHardware, waitForIdleGpu } from "../hardware.js";
import { LABELS } from "../labels.js";
import { runRulesFirst } from "../pipeline.js";
import {
  type Candidate,
  type Item,
  type ModelPrediction,
  type Outcome,
  type ReplyModel,
  Skip,
} from "../types.js";
import { JsonlProcess } from "./jsonl-process.js";
import { deviceLabel, pythonScript, venvPython } from "./python.js";

/** The large model on the GPU, and the base one on the CPU, where the large one needs seconds per reply. */
export const DEFAULT_NLI_MODELS = {
  cuda: "MoritzLaurer/deberta-v3-large-zeroshot-v2.0",
  cpu: "MoritzLaurer/deberta-v3-base-zeroshot-v2.0",
} as const;
const NEED_MIB = 3000;

/** One claim per class, each phrased so the email can entail it. */
export const HYPOTHESES: Record<ReplyClassification, string> = {
  bounce: "The email says the message could not be delivered.",
  auto_ack:
    "The email is an automatic acknowledgement that a request was received, with no decision.",
  confirmation_link: "The email asks the reader to click a link to confirm a request.",
  verification_required: "The email asks the reader for identity details or documents.",
  completed: "The email says the personal data was deleted or the person was opted out.",
  no_record: "The email says no record of the person was found.",
  rejected: "The email declines the request.",
  needs_form: "The email says the request must be made through a web form, a portal or by phone.",
  unrelated: "The email is marketing, a newsletter or personal mail, not about a privacy request.",
  unknown: "The email is unclear.",
};

function predictionOf(probabilities: number[]): ModelPrediction {
  const map: Partial<Record<ReplyClassification, number>> = {};
  let best = 0;
  for (const [index, label] of LABELS.entries()) {
    const value = probabilities[index] ?? 0;
    map[label] = value;
    if (value > (probabilities[best] ?? 0)) best = index;
  }
  return {
    label: LABELS[best] as ReplyClassification,
    confidence: probabilities[best] ?? 0,
    probabilities: map,
  };
}

export interface NliOptions {
  device: "cuda" | "cpu";
  model?: string;
  log: (message: string) => void;
}

/** (d) A zero-shot natural language inference model: each class is a hypothesis the email may entail. */
export function nliCandidate(options: NliOptions): Candidate {
  const name = options.model ?? process.env.REPLY_NLI_MODEL ?? DEFAULT_NLI_MODELS[options.device];
  let child: JsonlProcess | null = null;
  const hypotheses = LABELS.map((label) => HYPOTHESES[label]);
  const model: ReplyModel = {
    async predict(input) {
      if (!child) return null;
      try {
        const answer = await child.request<{ probabilities: number[] }>({
          text: `Subject: ${input.subject.slice(0, 300)}\n\n${input.body}`,
          hypotheses,
        });
        return predictionOf(answer.probabilities);
      } catch {
        return null;
      }
    },
  };
  return {
    id: `d-nli-${options.device === "cuda" ? "gpu" : "cpu"}`,
    description: `Rules, then zero-shot NLI with ${name} on ${deviceLabel(options.device)}`,
    hardware: "",
    async setup() {
      const python = venvPython();
      this.hardware = await describeHardware();
      if (options.device === "cuda") await waitForIdleGpu(NEED_MIB, options.log);
      child = new JsonlProcess(python, [
        pythonScript("nli.py"),
        "--model",
        name,
        "--device",
        options.device,
      ]);
      try {
        await child.read();
      } catch (error) {
        throw new Skip(`The NLI model did not start: ${(error as Error).message}`);
      }
    },
    runAll(items: Item[]): Promise<Outcome[]> {
      return runRulesFirst(items, model);
    },
    async dispose() {
      child?.stop();
      child = null;
    },
  };
}
