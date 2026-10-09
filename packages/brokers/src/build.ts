import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BROKER_DATASET_ATTRIBUTION,
  BROKER_DATASET_LICENSE,
  type Broker,
  type BrokerDataset,
  BrokerDataset as BrokerDatasetSchema,
} from "@kickrocks/shared";
import { z } from "zod";
import {
  applyCorrections,
  dropExcluded,
  parseCorrections,
  parseExclusions,
} from "./corrections.js";
import { parseBadboolReport } from "./import/badbool.js";
import { parseCaRegistry } from "./import/ca-registry.js";
import { parseCuratedBrokers } from "./import/curated.js";
import { parseEraserBrokers } from "./import/eraser.js";
import { loadCompanyDataset } from "./index.js";
import { mergeBrokers, withholdEmailEraserRefused } from "./merge.js";
import { applyOwnerGroups } from "./owner-groups.js";
import { readBundledRecipes, unpairedRecipeSenders } from "./recipe-senders.js";
import { applyReplyDomains } from "./reply-domains.js";
import { readPinnedUpstream } from "./upstream.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "..", "data");
const ERASER_PIN = "eraser.source.json";
const CA_REGISTRY_PIN = "ca-registry.source.json";
const bundledRecipesDir = resolve(here, "..", "..", "recipes", "recipes");
const outFile = resolve(dataDir, "generated", "brokers.json");
export const IDS_FILE = resolve(dataDir, "ids.json");

const PinnedIds = z.record(z.string(), z.string().regex(/^[a-z0-9][a-z0-9-]*$/));

/** The committed domain to id map. See {@link mergeBrokers} for why ids are pinned. */
export function loadPinnedIds(file = IDS_FILE): Record<string, string> {
  return existsSync(file) ? PinnedIds.parse(JSON.parse(readFileSync(file, "utf8"))) : {};
}

export function buildDataset(
  pinnedIds: Readonly<Record<string, string>> = loadPinnedIds(),
): BrokerDataset {
  readPinnedUpstream("BADBOOL-LICENSE.md");
  readPinnedUpstream("ERASER-LICENSE", { source: ERASER_PIN });
  const badbool = parseBadboolReport(readPinnedUpstream("BADBOOL-README.md")).brokers;
  const curated = parseCuratedBrokers(
    readFileSync(resolve(dataDir, "curated-brokers.yaml"), "utf8"),
  );
  const eraser = parseEraserBrokers(
    readPinnedUpstream("eraser-brokers.yaml", { source: ERASER_PIN }),
  );
  const registry = parseCaRegistry(
    readPinnedUpstream("ca-registry-2026.csv", { source: CA_REGISTRY_PIN }),
  );
  const companyDomains = loadCompanyDataset().companies.map((company) => company.domain);
  const excluded = parseExclusions(readFileSync(resolve(dataDir, "excluded.yaml"), "utf8"));
  const mergeImported = (lists: readonly (readonly Broker[])[]) =>
    mergeBrokers(withholdEmailEraserRefused([...lists, curated]), { pinnedIds });
  const imported = applyCorrections(
    dropExcluded(
      [badbool, eraser, registry],
      new Set([...excluded.map((entry) => entry.domain), ...companyDomains]),
    ),
    parseCorrections(readFileSync(resolve(dataDir, "corrections.yaml"), "utf8")),
    mergeImported,
  );
  const brokers = applyOwnerGroups(
    applyReplyDomains(
      mergeImported(imported),
      readFileSync(resolve(dataDir, "reply-domains.yaml"), "utf8"),
    ),
    readFileSync(resolve(dataDir, "owner-groups.yaml"), "utf8"),
  );
  const unpaired = unpairedRecipeSenders(brokers, readBundledRecipes(bundledRecipesDir));
  if (unpaired.length > 0) throw new Error(unpaired.join("\n"));
  return BrokerDatasetSchema.parse({
    generatedAt: new Date().toISOString(),
    license: BROKER_DATASET_LICENSE,
    attribution: BROKER_DATASET_ATTRIBUTION,
    brokers,
  });
}

/** Pins the id of every domain the dataset has that the map does not, keeping the map sorted. */
export function pinNewIds(
  pinnedIds: Readonly<Record<string, string>>,
  dataset: BrokerDataset,
): Record<string, string> {
  const next = { ...pinnedIds };
  for (const broker of dataset.brokers) next[broker.domain] ??= broker.id;
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
}

function summarize(dataset: BrokerDataset): string {
  const byCategory = new Map<string, number>();
  const byMethod = new Map<string, number>();
  for (const b of dataset.brokers) {
    byCategory.set(b.category, (byCategory.get(b.category) ?? 0) + 1);
    byMethod.set(b.contactMethod, (byMethod.get(b.contactMethod) ?? 0) + 1);
  }
  const fmt = (m: Map<string, number>) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
  return `${dataset.brokers.length} brokers | categories: ${fmt(byCategory)} | contact: ${fmt(byMethod)}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const companyCount = loadCompanyDataset().companies.length;
  const pinned = loadPinnedIds();
  const dataset = buildDataset(pinned);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(summarize(dataset));
  console.log(`${companyCount} companies validated`);
  console.log(`wrote ${outFile}`);

  const pinnedNow = pinNewIds(pinned, dataset);
  const added = Object.keys(pinnedNow).length - Object.keys(pinned).length;
  if (added > 0) {
    writeFileSync(IDS_FILE, `${JSON.stringify(pinnedNow, null, 2)}\n`);
    console.log(`pinned ${added} new broker ids in ${IDS_FILE}; commit it so they never change`);
  }
}
