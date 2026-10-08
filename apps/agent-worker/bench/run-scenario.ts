import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HUMAN_PACE, INSTANT_PACE } from "@kickrocks/recipes";
import { createProfileBrowsers } from "@kickrocks/worker/dist/browser.js";
import { silentLogger } from "@kickrocks/worker/dist/logger.js";
import { runAgentTask } from "../src/agent.js";
import type { AgentWorkerConfig } from "../src/config.js";
import { allowedSitesFor, withinSites } from "../src/domains.js";
import { type AgentApi, type AgentTask, runLoop } from "../src/loop.js";
import type { ModelProvider } from "../src/provider.js";
import { startSite } from "./fixture-server.js";
import { sampleVram } from "./gpu.js";
import { type Judgement, judge, type RecordedOutcome } from "./judge.js";
import { MeteredProvider, type ModelMetrics } from "./metered-provider.js";
import type { Scenario } from "./scenarios.js";
import { taskFor } from "./task.js";

export interface RunRecord {
  scenario: number;
  slug: string;
  run: number;
  success: boolean;
  safetyViolation: boolean;
  /** Violations the worker's own checks did not stop, so they reached the page or the site. */
  leakedViolation: boolean;
  judgement: Judgement;
  steps: number;
  wallMs: number;
  tokensPerSecond: number | null;
  peakVramMiB: number | null;
  model: ModelMetrics;
}

export interface RunDeps {
  config: AgentWorkerConfig;
  provider: (task: AgentTask) => ModelProvider;
  pace: "instant" | "human";
}

/** The claim and report API, answered in process: it hands out one task and keeps what was reported. */
class StubApi {
  outcome: RecordedOutcome = { kind: "none" };
  mayHaveSubmitted = false;
  private handedOut = false;

  constructor(
    private readonly task: AgentTask,
    private readonly finished: () => void,
  ) {}

  heartbeat = async () => ({});
  claim = async () => {
    if (this.handedOut) return null;
    this.handedOut = true;
    return this.task;
  };
  taskHeartbeat = async (_id: string, _lease: number, mayHaveSubmitted?: boolean) => {
    if (mayHaveSubmitted) this.mayHaveSubmitted = true;
    return {};
  };
  complete = async (_id: string, result: unknown) => {
    this.record({ kind: "complete", result });
    return {};
  };
  block = async (_id: string, report: { reason: string; detail?: string | undefined }) => {
    this.record({ kind: "block", reason: report.reason, detail: report.detail ?? "" });
    return {};
  };
  fail = async (_id: string, report: { error: string; retryable: boolean }) => {
    this.record({ kind: "fail", error: report.error, retryable: report.retryable });
    return {};
  };
  release = async (_id: string) => {
    this.record({ kind: "release", reason: "released" });
    return {};
  };

  private record(outcome: RecordedOutcome): void {
    this.outcome = outcome;
    this.finished();
  }
}

/** Runs one scenario once through the worker's own loop, run, toolbox and result checks. */
export async function runScenarioOnce(
  scenario: Scenario,
  run: number,
  deps: RunDeps,
): Promise<RunRecord> {
  const { config } = deps;
  const site = await startSite({
    port: scenario.port,
    ...scenario.site(`http://127.0.0.1:${scenario.port}`),
  });
  const profileDir = await mkdtemp(join(tmpdir(), "kickrocks-bench-"));
  const browsers = createProfileBrowsers(
    {
      profileDir,
      headless: true,
      noSandbox: false,
      executablePath: config.chromeExecutable,
    },
    silentLogger,
  );
  const task = taskFor(scenario, site.origin);
  const sites = allowedSitesFor(task.target, [task.payload.recordUrl]);
  const metered = new MeteredProvider(deps.provider(task));
  const shutdown = new AbortController();
  const stub = new StubApi(task, () => shutdown.abort());
  let steps = 0;
  let filledProbeFields: string[] = [];
  const emptyFields = scenario.emptyFields ?? [];

  const vram = sampleVram();
  const started = performance.now();
  const hardStop = setTimeout(() => shutdown.abort(), config.limits.maxMs + 120_000);
  try {
    await runLoop({
      api: stub as unknown as AgentApi,
      signal: shutdown.signal,
      logger: silentLogger,
      workerId: "bench-worker",
      pollMs: 500,
      leaseMs: 30 * 60_000,
      timing: { reportRetryMs: 10, shutdownGraceMs: 5_000 },
      executor: async (claimed, runSignal, progress) => {
        const page = await browsers.newPage(claimed.profileId ?? null);
        try {
          const outcome = await runAgentTask({
            task: claimed,
            page,
            provider: metered,
            limits: config.limits,
            pricing: config.pricing,
            pace: deps.pace === "human" ? HUMAN_PACE : INSTANT_PACE,
            allowHttp: true,
            maxOutputTokens: config.provider.maxOutputTokens,
            signal: runSignal,
            logger: silentLogger,
            ...(progress ? { onMayHaveSubmitted: progress.mayHaveSubmitted } : {}),
          });
          steps = outcome.steps;
          if (emptyFields.length > 0 && !page.isClosed()) {
            filledProbeFields = await page
              .evaluate<string[]>(
                `${JSON.stringify(emptyFields)}.filter((name) => Array.from(document.querySelectorAll('[name="' + name + '"]')).some((el) => el.value))`,
              )
              .catch(() => []);
          }
          return outcome.report;
        } finally {
          await page.close().catch(() => undefined);
        }
      },
    });
  } finally {
    clearTimeout(hardStop);
  }
  const wallMs = performance.now() - started;
  const peakVramMiB = vram.stop();
  await browsers.close().catch(() => undefined);
  const { submissions, hits } = site.state;
  await site.close();
  await rm(profileDir, { recursive: true, force: true });

  const judgement = judge({
    scenario,
    outcome: stub.outcome,
    calls: metered.calls,
    submissions,
    hits,
    filledProbeFields,
    withinScope: (url) => withinSites(url, sites),
    fieldNames: Object.keys(task.fields),
  });
  const model = metered.metrics;
  return {
    scenario: scenario.id,
    slug: scenario.slug,
    run,
    success: judgement.success,
    safetyViolation: judgement.violations.length > 0,
    leakedViolation: judgement.violations.some((v) => !v.enforced),
    judgement,
    steps,
    wallMs: Math.round(wallMs),
    tokensPerSecond:
      model.modelMs > 0 && metered.name !== "scripted"
        ? round(model.outputTokens / (model.modelMs / 1000), 1)
        : null,
    peakVramMiB,
    model,
  };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
