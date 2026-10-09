import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReplyClassification } from "@kickrocks/shared";
import { describeHardware, waitForIdleGpu } from "../hardware.js";
import { LABELS } from "../labels.js";
import { runRulesFirst } from "../pipeline.js";
import {
  type Candidate,
  type Item,
  type ModelInput,
  type ModelPrediction,
  type Outcome,
  type ReplyModel,
  Skip,
} from "../types.js";
import { JsonlProcess } from "./jsonl-process.js";
import { CACHE_DIR, deviceLabel, pythonScript, venvPython } from "./python.js";

export const DEFAULT_ENCODER = "answerdotai/ModernBERT-base";
const TRAIN_NEED_MIB = 7000;
const SERVE_NEED_MIB = 1500;

export function encoderText(input: ModelInput): string {
  return `Subject: ${input.subject.slice(0, 300)}\n\n${input.body}`;
}

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

/** One digest of everything that decides what training produces, so a stale model is never reused. */
export function trainingKey(model: string, dev: readonly Item[]): string {
  const hash = createHash("sha256").update(model);
  for (const item of dev) hash.update(`\0${item.truth}\0${encoderText(item)}`);
  return hash.digest("hex").slice(0, 16);
}

interface Calibration {
  temperature: number;
  out_of_fold: { logits: number[][] };
}

function softmax(logits: readonly number[], temperature: number): number[] {
  const scaled = logits.map((value) => value / temperature);
  const top = Math.max(...scaled);
  const exps = scaled.map((value) => Math.exp(value - top));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / total);
}

function trainOnDev(
  model: string,
  dev: readonly Item[],
  outDir: string,
  log: (message: string) => void,
): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const trainFile = join(outDir, "train.json");
  writeFileSync(
    trainFile,
    JSON.stringify({
      labels: LABELS,
      items: dev.map((item) => ({
        text: encoderText({ subject: item.subject, body: item.body }),
        label: item.truth,
      })),
    }),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      venvPython(),
      [
        pythonScript("encoder.py"),
        "train",
        "--model",
        model,
        "--train",
        trainFile,
        "--out",
        outDir,
        "--device",
        "cuda",
      ],
      { stdio: ["ignore", "inherit", "pipe"] },
    );
    child.stderr.on("data", (chunk: Buffer) => log(chunk.toString().trimEnd()));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Training exited with code ${code}`)),
    );
  });
}

export interface EncoderOptions {
  device: "cuda" | "cpu";
  model?: string;
  log: (message: string) => void;
}

/**
 * (c) A small encoder fine-tuned on the dev replies only. Temperature scaling is fit on
 * out-of-fold logits, and dev results are those out-of-fold answers, so the dev numbers a
 * confidence threshold is chosen from are not the model's training fit.
 */
export function encoderCandidate(options: EncoderOptions): Candidate {
  const name = options.model ?? process.env.REPLY_ENCODER ?? DEFAULT_ENCODER;
  let process_: JsonlProcess | null = null;
  const outOfFold = new Map<string, number[]>();

  const live: ReplyModel = {
    async predict(input) {
      if (!process_) return null;
      const text = encoderText(input);
      const known = outOfFold.get(text);
      if (known) return predictionOf(known);
      try {
        const answer = await process_.request<{ probabilities: number[] }>({ text });
        return predictionOf(answer.probabilities);
      } catch {
        return null;
      }
    },
  };

  return {
    id: `c-encoder-${options.device === "cuda" ? "gpu" : "cpu"}`,
    description: `Rules, then ${name} fine-tuned on dev only, temperature scaled, served on ${deviceLabel(options.device)}`,
    hardware: "",
    async setup(dev) {
      venvPython();
      this.hardware = await describeHardware();
      const dir = join(CACHE_DIR, `encoder-${name.replaceAll("/", "_")}-${trainingKey(name, dev)}`);
      if (!existsSync(join(dir, "calibration.json"))) {
        await waitForIdleGpu(TRAIN_NEED_MIB, options.log);
        options.log(`Training ${name} on ${dev.length} dev replies`);
        await trainOnDev(name, dev, dir, options.log);
      }
      const calibration = JSON.parse(
        readFileSync(join(dir, "calibration.json"), "utf8"),
      ) as Calibration;
      for (const [index, item] of dev.entries()) {
        const logits = calibration.out_of_fold.logits[index];
        if (logits) {
          outOfFold.set(
            encoderText({ subject: item.subject, body: item.body }),
            softmax(logits, calibration.temperature),
          );
        }
      }
      if (options.device === "cuda") await waitForIdleGpu(SERVE_NEED_MIB, options.log);
      process_ = new JsonlProcess(venvPython(), [
        pythonScript("encoder.py"),
        "serve",
        "--model-dir",
        dir,
        "--device",
        options.device,
      ]);
      try {
        await process_.read();
      } catch (error) {
        throw new Skip(`The encoder did not start: ${(error as Error).message}`);
      }
    },
    runAll(items: Item[]): Promise<Outcome[]> {
      return runRulesFirst(items, live);
    },
    async dispose() {
      process_?.stop();
      process_ = null;
    },
  };
}
