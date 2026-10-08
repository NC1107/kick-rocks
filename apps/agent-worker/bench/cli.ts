import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type BenchOptions, runBench } from "./bench.js";
import type { FakeKind } from "./fake-models.js";
import { markdownSummary } from "./report.js";

const USAGE = `Usage: pnpm --filter @kickrocks/agent-worker bench --model <ollama model> [options]

  --model <name>          The Ollama model to test. Required unless --fake is given.
  --runs <n>              Repeat every scenario and the reply set n times. Default 3.
  --scenarios <list>      Only these scenarios, for example 1,5,7. Default all twelve.
  --agent-only            Skip the reply classification bench.
  --replies-only          Skip the agent scenarios.
  --fake <perfect|bad>    Use a scripted model instead of Ollama, to check the harness itself.
  --base-url <url>        An OpenAI compatible endpoint. Default http://127.0.0.1:11434/v1.
  --pace <instant|human>  Typing and pause speed of the browser. Default instant.
  --max-steps <n>         Tool calls per run. Default is the worker's own, 40.
  --max-minutes <n>       Minutes per run. Default is the worker's own, 10.
  --max-output-tokens <n> Output tokens per turn. Default is the worker's own, 4096.
  --reply-timeout-ms <n>  Per reply timeout. Default is the server's own, 30000.
  --out <dir>             Where results go. Default apps/agent-worker/bench/results.
`;

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    runs: { type: "string", default: "3" },
    scenarios: { type: "string" },
    "agent-only": { type: "boolean", default: false },
    "replies-only": { type: "boolean", default: false },
    fake: { type: "string" },
    "base-url": { type: "string" },
    pace: { type: "string" },
    "max-steps": { type: "string" },
    "max-minutes": { type: "string" },
    "max-output-tokens": { type: "string" },
    "reply-timeout-ms": { type: "string" },
    out: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

function positive(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) fail(`--${name} needs a positive number`);
  return value;
}

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (values.fake !== undefined && values.fake !== "perfect" && values.fake !== "bad") {
  fail("--fake must be perfect or bad");
}
const fake = values.fake as FakeKind | undefined;
const model = values.model ?? (fake ? `fake-${fake}` : undefined);
if (!model) fail("--model is required");
if (values.pace !== undefined && values.pace !== "instant" && values.pace !== "human") {
  fail("--pace must be instant or human");
}
if (values["agent-only"] && values["replies-only"])
  fail("Pick one of --agent-only and --replies-only");

const scenarioIds = values.scenarios?.split(",").map((part) => Number(part.trim()));
if (scenarioIds?.some((id) => !Number.isInteger(id)))
  fail("--scenarios needs numbers such as 1,5,7");

const maxSteps = positive("max-steps", values["max-steps"]);
const maxMinutes = positive("max-minutes", values["max-minutes"]);
const maxOutputTokens = positive("max-output-tokens", values["max-output-tokens"]);
const replyTimeoutMs = positive("reply-timeout-ms", values["reply-timeout-ms"]);

const options: BenchOptions = {
  model,
  runs: positive("runs", values.runs) ?? 3,
  agent: !values["replies-only"],
  replies: !values["agent-only"],
  log: (line) => console.error(line),
  ...(scenarioIds ? { scenarios: scenarioIds } : {}),
  ...(fake ? { fake } : {}),
  ...(values["base-url"] ? { baseUrl: values["base-url"] } : {}),
  ...(values.pace ? { pace: values.pace as "instant" | "human" } : {}),
  ...(maxSteps ? { maxSteps } : {}),
  ...(maxMinutes ? { maxMinutes } : {}),
  ...(maxOutputTokens ? { maxOutputTokens } : {}),
  ...(replyTimeoutMs ? { replyTimeoutMs } : {}),
};

const results = await runBench(options);

const outDir = values.out ?? join(dirname(fileURLToPath(import.meta.url)), "results");
await mkdir(outDir, { recursive: true });
const stem = model.replace(/[^A-Za-z0-9._-]+/g, "_");
await writeFile(join(outDir, `${stem}.json`), `${JSON.stringify(results, null, 2)}\n`);
const markdown = markdownSummary(results);
await writeFile(join(outDir, `${stem}.md`), markdown);
console.log(markdown);
console.error(`Wrote ${join(outDir, `${stem}.json`)} and ${join(outDir, `${stem}.md`)}`);

const imperfect =
  (results.agent?.totals.runsWithViolation ?? 0) > 0 ||
  (results.agent?.totals.successRate ?? 1) < 1 ||
  (results.replies?.accuracy ?? 1) < 1;
process.exit(fake === "perfect" && imperfect ? 1 : 0);
