import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BROKER_DATASET_ATTRIBUTION,
  BROKER_DATASET_LICENSE,
  type BrokerDataset,
  BrokerDataset as BrokerDatasetSchema,
} from "@kickrocks/shared";
import { z } from "zod";
import { parseBadboolReport } from "./import/badbool.js";
import { parseCaRegistry } from "./import/ca-registry.js";
import { parseCuratedBrokers } from "./import/curated.js";
import { parseEraserBrokers } from "./import/eraser.js";
import { mergeBrokers } from "./merge.js";
import { readPinnedUpstream } from "./upstream.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "..", "data");
const upstream = resolve(dataDir, "upstream");
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
  const badbool = parseBadboolReport(readPinnedUpstream("BADBOOL-README.md")).brokers;
  const curated = parseCuratedBrokers(
    readFileSync(resolve(dataDir, "curated-brokers.yaml"), "utf8"),
  );
  const eraser = parseEraserBrokers(readFileSync(resolve(upstream, "eraser-brokers.yaml"), "utf8"));
  const registry = parseCaRegistry(readFileSync(resolve(upstream, "ca-registry-2025.csv"), "utf8"));
  const brokers = mergeBrokers([badbool, eraser, registry, curated], { pinnedIds });
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
  const pinned = loadPinnedIds();
  const dataset = buildDataset(pinned);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(summarize(dataset));
  console.log(`wrote ${outFile}`);

  const pinnedNow = pinNewIds(pinned, dataset);
  const added = Object.keys(pinnedNow).length - Object.keys(pinned).length;
  if (added > 0) {
    writeFileSync(IDS_FILE, `${JSON.stringify(pinnedNow, null, 2)}\n`);
    console.log(`pinned ${added} new broker ids in ${IDS_FILE}; commit it so they never change`);
  }
}
