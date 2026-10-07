import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type BrokerDataset, BrokerDataset as BrokerDatasetSchema } from "@kickrocks/shared";
import { parseCaRegistry } from "./import/ca-registry.js";
import { parseEraserBrokers } from "./import/eraser.js";
import { mergeBrokers } from "./merge.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "..", "data");
const upstream = resolve(dataDir, "upstream");
const outFile = resolve(dataDir, "generated", "brokers.json");

export function buildDataset(): BrokerDataset {
  const eraser = parseEraserBrokers(readFileSync(resolve(upstream, "eraser-brokers.yaml"), "utf8"));
  const registry = parseCaRegistry(readFileSync(resolve(upstream, "ca-registry-2025.csv"), "utf8"));
  const brokers = mergeBrokers(eraser, registry);
  return BrokerDatasetSchema.parse({ generatedAt: new Date().toISOString(), brokers });
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
  const dataset = buildDataset();
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(summarize(dataset));
  console.log(`wrote ${outFile}`);
}
