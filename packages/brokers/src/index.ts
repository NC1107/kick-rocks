import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Broker,
  type BrokerDataset,
  BrokerDataset as BrokerDatasetSchema,
  COMPANY_DATASET_LICENSE,
  type Company,
  type CompanyDataset,
  CompanyDataset as CompanyDatasetSchema,
} from "@kickrocks/shared";
import { type EmailRefusal, parseEmailRefusals } from "./corrections.js";

export { alignsWithAny, isTrustedConfirmationDomain } from "./confirmation-sender.js";
export type { EmailRefusal } from "./corrections.js";
export { type BadboolReport, parseBadbool, parseBadboolReport } from "./import/badbool.js";
export { parseCaRegistry } from "./import/ca-registry.js";
export { parseCuratedBrokers } from "./import/curated.js";
export { parseEraserBrokers } from "./import/eraser.js";
export { type MergeOptions, mergeBrokers } from "./merge.js";

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

const correctionsFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "corrections.yaml",
);

/** The addresses and channels a hand-checked note ruled out; the build has already applied them. */
export function loadEmailRefusals(): EmailRefusal[] {
  return parseEmailRefusals(readFileSync(correctionsFile, "utf8"));
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

/**
 * Whether the company file is present. A caller that syncs targets must treat its absence as
 * "unavailable", because an empty list would retire every company the instance already knows.
 */
export function hasCompanyDataset(): boolean {
  return existsSync(companiesFile);
}

/** The hand-curated company list. Missing means there is none yet, not that something broke. */
export function loadCompanyDataset(): CompanyDataset {
  if (!hasCompanyDataset()) {
    return {
      generatedAt: new Date(0).toISOString(),
      license: COMPANY_DATASET_LICENSE,
      companies: [],
    };
  }
  return CompanyDatasetSchema.parse(JSON.parse(readFileSync(companiesFile, "utf8")));
}

export function loadCompanies(): Company[] {
  return loadCompanyDataset().companies;
}
