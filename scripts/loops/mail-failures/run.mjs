#!/usr/bin/env node
// Runs the mail and scheduler failure matrix against the built server and prints one JSON result.
// The score is the number of failing checks, so lower is better. Build first with `pnpm build`.
//
//   pnpm loop:mail-failures [--only name,name] [--concurrency 4] [--keep-logs]
//
// It starts local fakes and scratch servers only: it never reaches a real mail host or broker.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./lib/instance.mjs";
import { runScenario, SCENARIOS } from "./scenarios.mjs";

const RUNS_DIR = join(ROOT, ".loop-runs", "mail-failures");

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

function previousScore() {
  try {
    return JSON.parse(readFileSync(join(RUNS_DIR, "last.json"), "utf8")).score;
  } catch {
    return null;
  }
}

const only = option("only", "").split(",").filter(Boolean);
const chosen = SCENARIOS.filter((scenario) => only.length === 0 || only.includes(scenario.name));
const concurrency = Number(option("concurrency", "4"));
const workDir = mkdtempSync(join(tmpdir(), "loop-mail-failures-"));

const results = [];
const queue = [...chosen];
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let scenario = queue.shift(); scenario; scenario = queue.shift()) {
      const result = await runScenario(scenario, join(workDir, scenario.name));
      results.push(result);
      console.error(
        `${result.name}: ${Object.values(result.checks).filter((v) => v === false).length} failing`,
      );
    }
  }),
);
results.sort(
  (a, b) =>
    SCENARIOS.findIndex((s) => s.name === a.name) - SCENARIOS.findIndex((s) => s.name === b.name),
);

const failing = results.flatMap((result) =>
  Object.entries(result.checks)
    .filter(([, held]) => held === false)
    .map(([check]) => `${result.name}:${check}`),
);
const before = previousScore();
const complete = chosen.length === SCENARIOS.length;
const output = {
  loop: "mail-failures",
  score: failing.length,
  scenariosFailing: results.filter((r) => Object.values(r.checks).includes(false)).length,
  scenarios: results.length,
  previousScore: before,
  // Two consecutive full runs at zero stop the loop.
  targetMet: complete && failing.length === 0 && before === 0,
  failing,
  results,
};

if (complete) {
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(join(RUNS_DIR, "last.json"), JSON.stringify(output, null, 2));
}
if (process.argv.includes("--keep-logs")) console.error(`logs kept in ${workDir}`);
else rmSync(workDir, { recursive: true, force: true });
console.log(JSON.stringify(output, null, 2));
