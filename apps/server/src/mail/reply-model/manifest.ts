import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ReplyClassification } from "@kickrocks/shared";
import { z } from "zod";
import { INPUT_FORMAT_VERSION } from "./input.js";

export const MANIFEST_FILE = "manifest.json";
/** The files the runtime reads. The manifest lists the digest of each. */
export const MODEL_FILES = ["model.onnx", "tokenizer.json", "tokenizer_config.json"] as const;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

const AtThreshold = z.object({
  answers: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  precision: z.number().nullable(),
  low: z.number().nullable(),
  high: z.number().nullable(),
});

const Metrics = z.object({
  replies: z.number().int().nonnegative(),
  accuracy: z.number(),
  /** Only the replies the rules leave under their own threshold, which is all the model ever answers. */
  atThreshold: AtThreshold,
});

/** What a model release says about itself. The server trusts none of it until the files match their digests. */
export const ReplyModelManifest = z.object({
  schemaVersion: z.literal(1),
  version: z.string().min(1),
  baseModel: z.object({ id: z.string().min(1), revision: z.string().regex(/^[0-9a-f]{40}$/) }),
  /** The output order of the model. The server maps outputs by name, so a reordered enum cannot shift them. */
  labels: z.array(ReplyClassification).min(2),
  temperature: z.number().positive(),
  maxLen: z.number().int().positive(),
  inputFormat: z.number().int().positive(),
  /** The confidence at which answers kept the precision the release was chosen for. */
  threshold: z.number().min(0).max(1),
  training: z.object({
    dataSha256: Sha256,
    scriptSha256: Sha256,
    lockfileSha256: Sha256,
    seed: z.number().int(),
    epochs: z.number().int(),
    folds: z.number().int(),
    batchSize: z.number().int(),
    learningRate: z.number(),
    device: z.string(),
    libraries: z.record(z.string(), z.string()),
  }),
  metrics: z.object({ outOfFold: Metrics, heldout: Metrics }),
  files: z.record(z.string(), z.object({ sha256: Sha256, bytes: z.number().int().positive() })),
});
export type ReplyModelManifest = z.infer<typeof ReplyModelManifest>;

export type ManifestRead =
  | { ok: true; manifest: ReplyModelManifest }
  | { ok: false; state: "not_installed" | "failed"; reason: string };

/** Reads and checks the manifest and the size of every file, without hashing the model. */
export function readManifest(dir: string): ManifestRead {
  const path = join(dir, MANIFEST_FILE);
  if (!existsSync(path)) {
    return { ok: false, state: "not_installed", reason: "No reply model is installed" };
  }
  let manifest: ReplyModelManifest;
  try {
    manifest = ReplyModelManifest.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    return {
      ok: false,
      state: "failed",
      reason: `The manifest cannot be read: ${describe(error)}`,
    };
  }
  const failure = mismatch(dir, manifest);
  return failure ? { ok: false, state: "failed", reason: failure } : { ok: true, manifest };
}

function mismatch(dir: string, manifest: ReplyModelManifest): string | null {
  if (manifest.inputFormat !== INPUT_FORMAT_VERSION) {
    return `The model reads input format ${manifest.inputFormat}, this server writes ${INPUT_FORMAT_VERSION}`;
  }
  const known = new Set<string>(ReplyClassification.options);
  const named = new Set<string>(manifest.labels);
  if (
    named.size !== manifest.labels.length ||
    [...known].some((label) => !named.has(label)) ||
    named.size !== known.size
  ) {
    return "The model's labels do not match the classifications this server knows";
  }
  for (const file of MODEL_FILES) {
    const listed = manifest.files[file];
    const path = join(dir, file);
    if (!listed) return `The manifest does not list ${file}`;
    if (!existsSync(path)) return `${file} is missing`;
    if (statSync(path).size !== listed.bytes) return `${file} is not the size the manifest says`;
  }
  return null;
}

function sha256Of(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** Hashes every file the runtime reads and returns the first that is not what the manifest says. */
export async function verifyFiles(
  dir: string,
  manifest: ReplyModelManifest,
): Promise<string | null> {
  for (const file of MODEL_FILES) {
    if ((await sha256Of(join(dir, file))) !== manifest.files[file]?.sha256) {
      return `${file} does not match its digest in the manifest`;
    }
  }
  return null;
}

export { sha256Of };

function describe(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? "invalid") : "invalid";
}
