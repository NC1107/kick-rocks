import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MEASURED_MODELS } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";

const RESULTS = join(dirname(fileURLToPath(import.meta.url)), "results");

interface ResultFile {
  model: string;
  environment: { ollamaVramBytes: number; thinking: "default" | "off" };
  agent: {
    totals: { runs: number; successes: number; runsWithViolation: number; meanWallMs: number };
  } | null;
  replies: { accuracy: number; runs: { cases: { latencyMs: number }[] }[] };
}

const results = new Map<string, ResultFile>(
  readdirSync(RESULTS)
    .filter((file) => /-ollama-num_ctx16384.*\.json$/.test(file))
    .map((file) => {
      const parsed = JSON.parse(readFileSync(join(RESULTS, file), "utf8")) as ResultFile;
      return [parsed.model, parsed] as const;
    }),
);

const oneDecimal = (value: number) => Math.round(value * 10) / 10;

function medianSeconds(file: ResultFile): number {
  const latencies = file.replies.runs.flatMap((run) => run.cases.map((c) => c.latencyMs));
  latencies.sort((a, b) => a - b);
  const low = latencies[(latencies.length - 1) >> 1] ?? 0;
  const high = latencies[latencies.length >> 1] ?? 0;
  return oneDecimal((low + high) / 2 / 1000);
}

describe("the measured models table", () => {
  it("has a committed result file for every model in it", () => {
    for (const model of MEASURED_MODELS) expect(results.has(model.name), model.name).toBe(true);
  });

  it.each(MEASURED_MODELS.map((model) => [model.name, model] as const))(
    "matches the result file for %s",
    (name, model) => {
      const file = results.get(name);
      if (!file) throw new Error(`no result file for ${name}`);
      expect(model.memoryGiB).toBe(oneDecimal(file.environment.ollamaVramBytes / 1024 ** 3));
      if (model.reply) {
        expect(model.reply.accuracyPct).toBe(oneDecimal(file.replies.accuracy * 100));
        expect(model.reply.medianSeconds).toBe(medianSeconds(file));
      }
      if (model.agent) {
        const totals = file.agent?.totals;
        if (!totals) throw new Error(`${name} has no agent result`);
        expect(model.agent.thinking).toBe(file.environment.thinking);
        expect(model.agent.successes).toBe(totals.successes);
        expect(model.agent.runs).toBe(totals.runs);
        expect(model.agent.violations).toBe(totals.runsWithViolation);
        expect(model.agent.secondsPerTask).toBe(oneDecimal(totals.meanWallMs / 1000));
      }
    },
  );

  it("ranks the agents by successes", () => {
    const agents = MEASURED_MODELS.filter((model) => model.agent).sort(
      (a, b) => (a.agent?.rank ?? 0) - (b.agent?.rank ?? 0),
    );
    const successes = agents.map((model) => model.agent?.successes ?? 0);
    expect(successes).toEqual([...successes].sort((a, b) => b - a));
  });

  it("leaves out the models that spill to the CPU on a 16 GB card", () => {
    const names = MEASURED_MODELS.map((model) => model.name);
    expect(names).not.toContain("qwen3.6:35b-a3b");
    expect(names).not.toContain("mistral-small3.2");
  });
});
