import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Broker,
  type BrokerDataset,
  BrokerDataset as BrokerDatasetSchema,
  type Company,
  type CompanyDataset,
  CompanyDataset as CompanyDatasetSchema,
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

const companiesFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "companies.json",
);

/** The hand-curated company list. Missing means there is none yet, not that something broke. */
export function loadCompanyDataset(): CompanyDataset {
  if (!existsSync(companiesFile)) {
    return { generatedAt: new Date(0).toISOString(), companies: [] };
  }
  return CompanyDatasetSchema.parse(JSON.parse(readFileSync(companiesFile, "utf8")));
}

export function loadCompanies(): Company[] {
  return loadCompanyDataset().companies;
}
