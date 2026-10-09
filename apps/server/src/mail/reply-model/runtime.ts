import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Tokenizer } from "@huggingface/tokenizers";
import * as ort from "onnxruntime-node";
import { type ReplyModelManifest, verifyFiles } from "./manifest.js";

export interface LoadedModel {
  /** Calibrated probabilities in the manifest's label order. */
  probabilities(text: string): Promise<number[]>;
  rssBytes(): number;
}

export function softmax(logits: readonly number[], temperature: number): number[] {
  const scaled = logits.map((value) => value / temperature);
  const top = Math.max(...scaled);
  const exps = scaled.map((value) => Math.exp(value - top));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / total);
}

/** Cuts to the window the model was trained with, keeping the closing token it expects last. */
export function truncate(ids: readonly number[], maxLen: number): number[] {
  return ids.length <= maxLen
    ? [...ids]
    : [...ids.slice(0, maxLen - 1), ids[ids.length - 1] as number];
}

/**
 * Checks every file against the manifest, then opens the model. The weights are not packed into
 * a second copy, because 235 MiB of memory matters more than the 5 ms it saves on polled mail.
 */
export async function loadModel(
  dir: string,
  manifest: ReplyModelManifest,
  threads: number,
): Promise<LoadedModel> {
  const bad = await verifyFiles(dir, manifest);
  if (bad) throw new Error(bad);
  const tokenizer = new Tokenizer(
    JSON.parse(readFileSync(join(dir, "tokenizer.json"), "utf8")),
    JSON.parse(readFileSync(join(dir, "tokenizer_config.json"), "utf8")),
  );
  const session = await ort.InferenceSession.create(join(dir, "model.onnx"), {
    executionProviders: ["cpu"],
    intraOpNumThreads: threads,
    graphOptimizationLevel: "all",
    extra: { session: { disable_prepacking: "1" } },
  });
  return {
    async probabilities(text) {
      const ids = truncate(tokenizer.encode(text).ids, manifest.maxLen);
      const shape = [1, ids.length];
      const out = await session.run({
        input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), shape),
        attention_mask: new ort.Tensor("int64", new BigInt64Array(ids.length).fill(1n), shape),
      });
      const logits = out.logits?.data;
      if (!logits) throw new Error("The model returned no logits");
      return softmax(Array.from(logits as Float32Array), manifest.temperature);
    },
    rssBytes: () => process.memoryUsage().rss,
  };
}
