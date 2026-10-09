import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReplyClassification } from "@kickrocks/shared";
import { INPUT_FORMAT_VERSION } from "../src/mail/reply-model/input.js";
import {
  MANIFEST_FILE,
  MODEL_FILES,
  ReplyModelManifest,
  sha256Of,
} from "../src/mail/reply-model/manifest.js";
import type { Recipe } from "./data.js";
import type { AtThreshold } from "./threshold.js";

export interface SplitMetrics {
  replies: number;
  accuracy: number;
  atThreshold: AtThreshold;
}

export interface ReleaseInputs {
  version: string;
  recipe: Recipe;
  labels: readonly ReplyClassification[];
  temperature: number;
  threshold: number;
  dataSha256: string;
  scriptSha256: string;
  lockfileSha256: string;
  libraries: Record<string, string>;
  outOfFold: SplitMetrics;
  heldout: SplitMetrics;
  files: ReplyModelManifest["files"];
}

export function buildManifest(inputs: ReleaseInputs): ReplyModelManifest {
  const { recipe } = inputs;
  return ReplyModelManifest.parse({
    schemaVersion: 1,
    version: inputs.version,
    baseModel: recipe.baseModel,
    labels: inputs.labels,
    temperature: inputs.temperature,
    maxLen: recipe.maxLen,
    inputFormat: INPUT_FORMAT_VERSION,
    threshold: inputs.threshold,
    training: {
      dataSha256: inputs.dataSha256,
      scriptSha256: inputs.scriptSha256,
      lockfileSha256: inputs.lockfileSha256,
      seed: recipe.seed,
      epochs: recipe.epochs,
      folds: recipe.folds,
      batchSize: recipe.batchSize,
      learningRate: recipe.learningRate,
      device: recipe.device,
      libraries: inputs.libraries,
    },
    metrics: { outOfFold: inputs.outOfFold, heldout: inputs.heldout },
    files: inputs.files,
  });
}

/** Size and digest of every file the runtime reads. */
export async function describeFiles(dir: string): Promise<ReplyModelManifest["files"]> {
  const files: ReplyModelManifest["files"] = {};
  for (const file of MODEL_FILES) {
    const path = join(dir, file);
    files[file] = { sha256: await sha256Of(path), bytes: statSync(path).size };
  }
  return files;
}

export function writeManifest(dir: string, manifest: ReplyModelManifest): void {
  writeFileSync(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Packs a release folder into one tar with names in a fixed order and no owner or time, so the
 * same files always give the same archive.
 */
export async function packRelease(dir: string, tarPath: string): Promise<string> {
  execFileSync(
    "tar",
    [
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "-cf",
      tarPath,
      "-C",
      dir,
      MANIFEST_FILE,
      ...MODEL_FILES,
    ],
    { stdio: "inherit" },
  );
  return sha256Of(tarPath);
}

export function readManifestFile(dir: string): ReplyModelManifest {
  return ReplyModelManifest.parse(JSON.parse(readFileSync(join(dir, MANIFEST_FILE), "utf8")));
}
