import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReplyClassification } from "@kickrocks/shared";
import { createReplyModelHost } from "../../../src/mail/reply-model/host.js";
import { encoderText } from "../../../src/mail/reply-model/input.js";
import { readManifest } from "../../../src/mail/reply-model/manifest.js";
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
import {
  CACHE_DIR,
  deviceLabel,
  REPLY_MODEL_DIR,
  REPLY_MODEL_SCRIPT,
  replyModelPython,
} from "./python.js";

export { encoderText };

export const DEFAULT_ENCODER = "answerdotai/ModernBERT-base";
const TRAIN_NEED_MIB = 7000;
const SERVE_NEED_MIB = 1500;

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
  const hash = createHash("sha256")
    .update(model)
    .update(readFileSync(REPLY_MODEL_SCRIPT))
    .update(readFileSync(join(REPLY_MODEL_DIR, "recipe.json")));
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
  dev: readonly Item[],
  outDir: string,
  device: "cuda" | "cpu",
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
    // The GPU is only for speed here; a release is always built on the CPU in fp32.
    const flags = device === "cuda" ? ["--bf16"] : [];
    const child = spawn(
      replyModelPython(),
      [
        REPLY_MODEL_SCRIPT,
        "train",
        "--train",
        trainFile,
        "--out",
        outDir,
        "--device",
        device,
        ...flags,
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

/** Out-of-fold probabilities by input text, so a dev reply is never answered by a model that trained on it. */
function outOfFoldBy(dev: readonly Item[], calibration: Calibration): Map<string, number[]> {
  const known = new Map<string, number[]>();
  for (const [index, item] of dev.entries()) {
    const logits = calibration.out_of_fold.logits[index];
    if (logits) {
      known.set(
        encoderText({ subject: item.subject, body: item.body }),
        softmax(logits, calibration.temperature),
      );
    }
  }
  return known;
}

/**
 * (c) A small encoder fine-tuned on the dev replies only, by the server's own recipe. Temperature
 * scaling is fit on out-of-fold logits, and dev results are those out-of-fold answers, so the dev
 * numbers a confidence threshold is chosen from are not the model's training fit.
 */
export function encoderCandidate(options: EncoderOptions): Candidate {
  const name = options.model ?? process.env.REPLY_ENCODER ?? DEFAULT_ENCODER;
  let process_: JsonlProcess | null = null;
  let outOfFold = new Map<string, number[]>();

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
      replyModelPython();
      this.hardware = await describeHardware();
      const dir = join(CACHE_DIR, `encoder-${name.replaceAll("/", "_")}-${trainingKey(name, dev)}`);
      if (!existsSync(join(dir, "calibration.json"))) {
        if (options.device === "cuda") await waitForIdleGpu(TRAIN_NEED_MIB, options.log);
        options.log(`Training ${name} on ${dev.length} dev replies`);
        await trainOnDev(dev, dir, options.device, options.log);
      }
      outOfFold = outOfFoldBy(
        dev,
        JSON.parse(readFileSync(join(dir, "calibration.json"), "utf8")) as Calibration,
      );
      if (options.device === "cuda") await waitForIdleGpu(SERVE_NEED_MIB, options.log);
      process_ = new JsonlProcess(replyModelPython(), [
        REPLY_MODEL_SCRIPT,
        "serve",
        "--model-dir",
        join(dir, "checkpoint"),
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

export interface NodeEncoderOptions {
  log: (message: string) => void;
  /** The release folder with manifest.json and dev-oof.json. Defaults to the build output of the recipe. */
  releaseDir?: string;
}

interface OutOfFoldFile {
  temperature: number;
  items: { text: string; logits: number[] }[];
}

/**
 * (c) again, but the shipped model: the ONNX release run by the server's own host, in its child
 * process. Dev answers are the build's out-of-fold answers; everything else goes through the
 * runtime, so this measures what a person's server would answer.
 */
export function encoderNodeCandidate(options: NodeEncoderOptions): Candidate {
  const releaseDir =
    options.releaseDir ?? process.env.REPLY_MODEL_RELEASE_DIR ?? join(REPLY_MODEL_DIR, "dist");
  let host: ReturnType<typeof createReplyModelHost> | null = null;
  let outOfFold = new Map<string, number[]>();
  // Held-out always goes through the runtime, even a reply that repeats a dev reply word for word.
  let reading: "dev" | "heldout" = "dev";

  const live: ReplyModel = {
    async predict(input) {
      if (!host) return null;
      const known = reading === "dev" ? outOfFold.get(encoderText(input)) : undefined;
      if (known) return predictionOf(known);
      const result = await host.predict(input);
      if (!result.ok) return null;
      return predictionOf(LABELS.map((label) => result.answer.probabilities[label]));
    },
  };

  return {
    id: "c-encoder-node",
    description:
      "Rules, then the released ONNX model through the server's own runtime (child process, CPU, fp32)",
    hardware: "",
    async setup() {
      const read = readManifest(releaseDir);
      if (!read.ok) throw new Skip(`No reply model release in ${releaseDir}: ${read.reason}`);
      const oofPath = join(releaseDir, "dev-oof.json");
      if (!existsSync(oofPath)) throw new Skip(`${releaseDir} has no dev-oof.json`);
      const oof = JSON.parse(readFileSync(oofPath, "utf8")) as OutOfFoldFile;
      outOfFold = new Map(
        oof.items.map((item) => [item.text, softmax(item.logits, oof.temperature)]),
      );
      this.hardware = `${await describeHardware()}, model ${read.manifest.version}`;
      host = createReplyModelHost({ dir: releaseDir, log: options.log });
      // The first answer loads the model, which would otherwise count against one reply's time.
      await host.predict({ subject: "warm up", body: "Thank you for contacting us." });
    },
    runAll(items: Item[]): Promise<Outcome[]> {
      reading = items.every((item) => item.split === "dev") ? "dev" : "heldout";
      return runRulesFirst(items, live);
    },
    async dispose() {
      await host?.close();
      host = null;
    },
  };
}
