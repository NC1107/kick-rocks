import { loadAgentWorkerConfig, OLLAMA_BASE_URL } from "../src/config.js";
import type { ModelProvider } from "../src/provider.js";
import { createProvider } from "../src/providers/index.js";
import { type FakeKind, fakeModel } from "./fake-models.js";
import { readVramMiB } from "./gpu.js";
import { ollamaStatus } from "./ollama.js";
import { fakeReplyFetch, type ReplyRun, runReplyBench } from "./replies.js";
import { type BenchResults, summarizeReplies, summarizeScenarios, totalsOf } from "./report.js";
import { type RunRecord, runScenarioOnce } from "./run-scenario.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";

export interface BenchOptions {
  model: string;
  baseUrl?: string;
  runs: number;
  scenarios?: number[];
  fake?: FakeKind;
  pace?: "instant" | "human";
  maxSteps?: number;
  maxMinutes?: number;
  maxOutputTokens?: number;
  agent: boolean;
  replies: boolean;
  replyTimeoutMs?: number;
  log?: (line: string) => void;
}

/** One short request, so the weights are in memory before the first timed run. */
async function warmUp(baseUrl: string, model: string, log: (line: string) => void): Promise<void> {
  const started = performance.now();
  try {
    await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: "user", content: "Say ok." }],
      }),
      signal: AbortSignal.timeout(300_000),
    });
    log(`warm-up took ${Math.round(performance.now() - started)} ms`);
  } catch (error) {
    log(`warm-up failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function runBench(options: BenchOptions): Promise<BenchResults> {
  const log = options.log ?? (() => undefined);
  const baseUrl = (options.baseUrl ?? OLLAMA_BASE_URL.replace("localhost", "127.0.0.1")).replace(
    /\/+$/,
    "",
  );
  const config = loadAgentWorkerConfig({
    KICKROCKS_WORKER_TOKEN: "benchmark-worker-token",
    KICKROCKS_AGENT_PROVIDER: "openai",
    KICKROCKS_AGENT_MODEL: options.model,
    KICKROCKS_AGENT_BASE_URL: baseUrl,
    ...(options.maxSteps ? { KICKROCKS_AGENT_MAX_STEPS: String(options.maxSteps) } : {}),
    ...(options.maxMinutes ? { KICKROCKS_AGENT_MAX_MINUTES: String(options.maxMinutes) } : {}),
    ...(options.maxOutputTokens
      ? { KICKROCKS_AGENT_MAX_OUTPUT_TOKENS: String(options.maxOutputTokens) }
      : {}),
    ...(process.env.KICKROCKS_CHROME_EXECUTABLE
      ? { KICKROCKS_CHROME_EXECUTABLE: process.env.KICKROCKS_CHROME_EXECUTABLE }
      : {}),
  });
  const startedAt = new Date().toISOString();
  const idleVramMiB = await readVramMiB();
  const scenarios: Scenario[] = options.scenarios
    ? options.scenarios.map((id) => {
        const found = SCENARIOS.find((s) => s.id === id);
        if (!found) throw new Error(`There is no scenario ${id}`);
        return found;
      })
    : SCENARIOS;
  const pace = options.pace ?? "instant";

  if (!options.fake) await warmUp(baseUrl, options.model, log);
  const loadedAtStart = options.fake
    ? { contextLength: null, sizeVram: null }
    : await ollamaStatus(baseUrl, options.model);

  const agentRuns: RunRecord[] = [];
  if (options.agent) {
    for (let run = 1; run <= options.runs; run++) {
      for (const scenario of scenarios) {
        const record = await runScenarioOnce(scenario, run, {
          config,
          pace,
          provider: (task): ModelProvider =>
            options.fake
              ? fakeModel(options.fake, scenario.id, task)
              : createProvider(config.provider),
        });
        agentRuns.push(record);
        log(
          `scenario ${scenario.id} run ${run}: ${record.success ? "ok" : "FAIL"} ${record.judgement.observed} ` +
            `(${record.steps} steps, ${Math.round(record.wallMs / 1000)}s` +
            `${record.safetyViolation ? `, ${record.judgement.violations.length} violation(s)` : ""})`,
        );
      }
    }
  }

  const replyRuns: ReplyRun[] = [];
  if (options.replies) {
    for (let run = 1; run <= options.runs; run++) {
      const reply = await runReplyBench({
        settings: { baseUrl, model: options.model, apiKey: null },
        ...(options.fake ? { fetchImpl: fakeReplyFetch(options.fake) } : {}),
        ...(options.replyTimeoutMs ? { timeoutMs: options.replyTimeoutMs } : {}),
      });
      replyRuns.push(reply);
      log(
        `replies run ${run}: accuracy ${(reply.summary.accuracy * 100).toFixed(1)}%, invalid JSON ${(reply.summary.invalidJsonRate * 100).toFixed(1)}%, median ${reply.summary.latencyMs.median} ms`,
      );
    }
  }

  // A model can be unloaded by the time the runs end, so the reading taken after the warm-up is the fallback.
  const loadedAtEnd = options.fake
    ? { contextLength: null, sizeVram: null }
    : await ollamaStatus(baseUrl, options.model);
  const status = {
    contextLength: loadedAtEnd.contextLength ?? loadedAtStart.contextLength,
    sizeVram: loadedAtEnd.sizeVram ?? loadedAtStart.sizeVram,
  };
  return {
    model: options.model,
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: {
      baseUrl,
      runsPerScenario: options.runs,
      maxSteps: config.limits.maxSteps,
      maxMinutes: Math.round(config.limits.maxMs / 600) / 100,
      maxOutputTokens: config.provider.maxOutputTokens,
      pace,
      idleVramMiB,
      ollamaContextLength: status.contextLength,
      ollamaVramBytes: status.sizeVram,
    },
    agent: options.agent
      ? {
          totals: totalsOf(agentRuns),
          scenarios: summarizeScenarios(agentRuns),
          runs: agentRuns,
        }
      : null,
    replies: options.replies ? summarizeReplies(replyRuns) : null,
  };
}
