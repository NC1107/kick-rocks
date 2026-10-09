import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { encoderCandidate } from "./candidates/encoder.js";
import { jevCandidate } from "./candidates/jev.js";
import { labelScoringCandidate } from "./candidates/label-scoring.js";
import { nliCandidate } from "./candidates/nli.js";
import { productionCandidate } from "./candidates/production.js";
import { duplicatesAcross, loadItems } from "./corpus.js";
import { devGateOf, evaluateHeldout, evaluateSplit } from "./evaluate.js";
import { describeHardware } from "./hardware.js";
import { runRulesOnly } from "./pipeline.js";
import { type CandidateResult, type RunReport, renderReport } from "./report.js";
import { type Candidate, type Item, Skip, type Source } from "./types.js";

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "results");

const USAGE = `pnpm bench:replies [options]

  --candidates a,b   Comma separated ids to run. Default: all.
                     rules, a-rules-llm, b-label-scoring, c-encoder-gpu, c-encoder-cpu,
                     d-nli-gpu, d-nli-cpu, e-jev
  --sources x,y      tuning, intake. Default: both.
  --split s          dev or both. Default: both. Held-out is only for checking a
                     finished result, never for tuning, so "dev" leaves it unread.
  --model name       Ollama model for candidates a and b. Default: granite4.1:8b.
  --out dir          Where to write the JSON and Markdown report. Default: bench/reply-classifier/results.
  --help
`;

function log(message: string): void {
  console.error(message);
}

function registry(model: string | undefined): Candidate[] {
  const common = { log, ...(model ? { model } : {}) };
  return [
    {
      id: "rules",
      description: "The rules alone, with no model behind them",
      hardware: "CPU, no model",
      async setup() {},
      runAll: (items: Item[]) => runRulesOnly(items),
      async dispose() {},
    },
    productionCandidate(common),
    labelScoringCandidate(common),
    encoderCandidate({ device: "cuda", log }),
    encoderCandidate({ device: "cpu", log }),
    nliCandidate({ device: "cuda", log }),
    nliCandidate({ device: "cpu", log }),
    jevCandidate(),
  ];
}

async function runCandidate(
  candidate: Candidate,
  dev: Item[],
  heldout: Item[],
): Promise<CandidateResult> {
  const base = { id: candidate.id, description: candidate.description };
  try {
    await candidate.setup(dev);
    const devOutcomes = await candidate.runAll(dev);
    const devEvaluation = evaluateSplit(dev, devOutcomes);
    const devGate = devGateOf(dev, devOutcomes);
    const heldoutEvaluation =
      heldout.length === 0
        ? null
        : evaluateHeldout(heldout, await candidate.runAll(heldout), devGate);
    return {
      ...base,
      hardware: candidate.hardware,
      status: "ran",
      dev: devEvaluation,
      heldout: heldoutEvaluation,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ...base, status: error instanceof Skip ? "skipped" : "failed", reason };
  } finally {
    await candidate.dispose();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      candidates: { type: "string" },
      sources: { type: "string" },
      split: { type: "string", default: "both" },
      model: { type: "string" },
      out: { type: "string", default: RESULTS_DIR },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const sources = (values.sources?.split(",") ?? ["tuning", "intake"]) as Source[];
  const splits = values.split as string;
  if (!["dev", "both"].includes(splits)) throw new Error(`Unknown split "${splits}"`);

  const all = registry(values.model);
  const wanted = values.candidates?.split(",");
  const chosen = wanted ? all.filter((candidate) => wanted.includes(candidate.id)) : all;
  for (const id of wanted ?? []) {
    if (!all.some((candidate) => candidate.id === id)) throw new Error(`Unknown candidate "${id}"`);
  }

  // Training and calibration read dev only; held-out is loaded for the final check and nothing else.
  const dev = await loadItems("dev", sources);
  const heldout = splits === "dev" ? [] : await loadItems("heldout", sources);
  const report: RunReport = {
    startedAt: new Date().toISOString(),
    hardware: await describeHardware(),
    sources,
    counts: { dev: dev.length, heldout: heldout.length },
    heldoutRepeatsOfDev: duplicatesAcross(dev, heldout),
    results: [],
  };

  for (const candidate of chosen) {
    log(`Running ${candidate.id}`);
    report.results.push(await runCandidate(candidate, dev, heldout));
  }

  mkdirSync(values.out as string, { recursive: true });
  const stamp = report.startedAt.replaceAll(/[:.]/g, "-");
  writeFileSync(join(values.out as string, `${stamp}.json`), JSON.stringify(report, null, 2));
  const markdown = renderReport(report);
  writeFileSync(join(values.out as string, `${stamp}.md`), `${markdown}\n`);
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
