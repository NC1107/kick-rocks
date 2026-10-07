import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Broker,
  type BrokerDataset,
  BrokerDataset as BrokerDatasetSchema,
} from "@kickrocks/shared";

export { parseCaRegistry } from "./import/ca-registry.js";
export { parseEraserBrokers } from "./import/eraser.js";
export { mergeBrokers } from "./merge.js";

const generatedFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "generated",
  "brokers.json",
);

let cached: BrokerDataset | null = null;

export function hasGeneratedDataset(): boolean {
  return existsSync(generatedFile);
}

/** Loads the generated dataset. Run `pnpm data:build` first; the file is not committed. */
export function loadBrokerDataset(): BrokerDataset {
  if (cached) return cached;
  if (!hasGeneratedDataset()) {
    throw new Error(`Broker dataset missing at ${generatedFile}. Run "pnpm data:build".`);
  }
  cached = BrokerDatasetSchema.parse(JSON.parse(readFileSync(generatedFile, "utf8")));
  return cached;
}

export function loadBrokers(): Broker[] {
  return loadBrokerDataset().brokers;
}
