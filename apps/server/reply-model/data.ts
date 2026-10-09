import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReplyClassification } from "@kickrocks/shared";
import { z } from "zod";
import { loadItems } from "../bench/reply-classifier/corpus.js";
import { modelInputOf, prepare, rulesStage } from "../bench/reply-classifier/pipeline.js";
import type { Item, Split } from "../bench/reply-classifier/types.js";
import { encoderText } from "../src/mail/reply-model/input.js";
import { RULES_THRESHOLD } from "../src/mail/thresholds.js";

export const REPLY_MODEL_DIR = dirname(fileURLToPath(import.meta.url));

export const Recipe = z.object({
  baseModel: z.object({ id: z.string(), revision: z.string().regex(/^[0-9a-f]{40}$/) }),
  seed: z.number().int(),
  epochs: z.number().int().positive(),
  folds: z.number().int().min(2),
  batchSize: z.number().int().positive(),
  learningRate: z.number().positive(),
  maxLen: z.number().int().positive(),
  threads: z.number().int().positive(),
  device: z.enum(["cpu", "cuda"]),
  precisionTarget: z.number().min(0).max(1),
  minAnswers: z.number().int().positive(),
  heldoutFloor: z.number().min(0).max(1),
});
export type Recipe = z.infer<typeof Recipe>;

export function loadRecipe(): Recipe {
  return Recipe.parse(JSON.parse(readFileSync(join(REPLY_MODEL_DIR, "recipe.json"), "utf8")));
}

/** Both sources the bench measures: written replies and the mixed-inbox mail the poll would see. */
const SOURCES = ["tuning", "intake"] as const;

export interface Row {
  id: string;
  /** Exactly what the model is shown. */
  text: string;
  label: ReplyClassification;
  rulesLabel: ReplyClassification;
  rulesConfidence: number;
}

/** The replies of one split, each with the text the server would give the model and what the rules say. */
export async function rowsOf(split: Split): Promise<Row[]> {
  const items: Item[] = await loadItems(split, SOURCES);
  const rows: Row[] = [];
  for (const prepared of await prepare(items)) {
    const rules = await rulesStage(prepared);
    rows.push({
      id: prepared.item.id,
      text: encoderText(modelInputOf(prepared.message)),
      label: prepared.item.truth,
      rulesLabel: rules.classification,
      rulesConfidence: rules.confidence,
    });
  }
  return rows;
}

/** The replies the rules leave under their own threshold, which are the only ones the model answers. */
export function leftToModel(rows: readonly Row[]): Row[] {
  return rows.filter((row) => row.rulesConfidence < RULES_THRESHOLD);
}

/** One digest of everything training reads: each reply's text and label, in order. */
export function dataSha256(rows: readonly Pick<Row, "id" | "text" | "label">[]): string {
  const hash = createHash("sha256");
  for (const row of rows) hash.update(`${row.id}\0${row.label}\0${row.text}\0`);
  return hash.digest("hex");
}

export function fileSha256(...paths: string[]): string {
  const hash = createHash("sha256");
  for (const path of paths) hash.update(readFileSync(path));
  return hash.digest("hex");
}
