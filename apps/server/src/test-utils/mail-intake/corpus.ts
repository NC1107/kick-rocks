import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReplyClassification } from "@kickrocks/shared";
import type { RequestKey } from "./world.js";

/**
 * What should happen to a message:
 * - `ignore`: nothing to act on, so it should leave no trace in the app.
 * - `auto`: it belongs to `request` and is applied without a person.
 * - `review`: a person should see it in Review. It may stay unattached, but if it is attached it
 *   must be to `request` and carry `classification`.
 */
export type Outcome = "ignore" | "auto" | "review";

export interface MessageLabel {
  file: string;
  category: string;
  outcome: Outcome;
  request: RequestKey | null;
  classification: ReplyClassification | null;
}

export type CorpusSet = "dev" | "held-out";

export interface CorpusMessage extends MessageLabel {
  raw: Buffer;
}

export const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "mail-intake",
);

export function loadLabels(set: CorpusSet, root = FIXTURES_DIR): MessageLabel[] {
  return JSON.parse(readFileSync(join(root, set, "labels.json"), "utf8")) as MessageLabel[];
}

export function loadCorpus(set: CorpusSet, root = FIXTURES_DIR): CorpusMessage[] {
  return loadLabels(set, root).map((label) => ({
    ...label,
    raw: readFileSync(join(root, set, label.file)),
  }));
}
