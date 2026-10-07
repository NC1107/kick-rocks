import { HUMAN_PACE, INSTANT_PACE, type Pace } from "@kickrocks/recipes";
import { WorkerApiClient } from "@kickrocks/worker/dist/api-client.js";
import { type BrowserLauncher, createProfileBrowsers } from "@kickrocks/worker/dist/browser.js";
import { describeError, type Logger } from "@kickrocks/worker/dist/logger.js";
import type { Page } from "playwright";
import { runAgentTask } from "./agent.js";
import type { AgentWorkerConfig } from "./config.js";
import { type AgentExecutor, type LoopContext, runLoop } from "./loop.js";
import type { ModelProvider } from "./provider.js";
import { createProvider } from "./providers/index.js";
import { readAgentWorkerVersion } from "./version.js";

/** A browser that will not start is the worker's problem, not the task's. */
const BROWSER_UNAVAILABLE_RETRY_MS = 60_000;

export interface AgentWorkerOptions {
  config: AgentWorkerConfig;
  signal: AbortSignal;
  logger: Logger;
  /** Replaced in tests. */
  launcher?: BrowserLauncher;
  provider?: ModelProvider;
  fetch?: typeof fetch;
  timing?: LoopContext["timing"];
  challengeGraceMs?: number;
}

/** Builds the agent worker from its config and runs it until the signal aborts, then closes the browser. */
export async function runAgentWorker(options: AgentWorkerOptions): Promise<void> {
  const { config, signal, logger } = options;
  const api = new WorkerApiClient({
    serverUrl: config.serverUrl,
    token: config.token,
    workerId: config.workerId,
    claimer: "model",
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const provider = options.provider ?? createProvider(config.provider);
  const browsers = createProfileBrowsers(
    {
      profileDir: config.chromeProfileDir,
      headless: config.headless,
      noSandbox: config.noSandbox,
      executablePath: config.chromeExecutable,
    },
    logger,
    options.launcher,
  );
  const pace: Pace = config.pace === "instant" ? INSTANT_PACE : HUMAN_PACE;

  const executor: AgentExecutor = async (task, runSignal, progress) => {
    let page: Page;
    try {
      page = await browsers.newPage(task.profileId ?? null);
    } catch (error) {
      logger.error("could not open a browser page", { error: describeError(error) });
      return {
        kind: "release",
        reason: "the browser is not available",
        retryAfterMs: BROWSER_UNAVAILABLE_RETRY_MS,
      };
    }
    try {
      const { report, steps } = await runAgentTask({
        task,
        page,
        provider,
        limits: config.limits,
        pricing: config.pricing,
        pace,
        allowHttp: config.allowHttp,
        maxOutputTokens: config.provider.maxOutputTokens,
        signal: runSignal,
        logger,
        ...(progress ? { onMayHaveSubmitted: progress.mayHaveSubmitted } : {}),
        ...(options.challengeGraceMs === undefined
          ? {}
          : { challengeGraceMs: options.challengeGraceMs }),
      });
      const usage =
        report.kind === "complete"
          ? report.usage
          : report.kind === "block"
            ? report.report.usage
            : report.kind === "fail"
              ? report.report.usage
              : undefined;
      logger.info("agent run finished", {
        taskId: task.id,
        report: report.kind,
        steps,
        model: provider.model,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        durationMs: usage?.durationMs,
      });
      return report;
    } finally {
      await page.close().catch(() => undefined);
    }
  };

  try {
    await runLoop({
      api,
      executor,
      signal,
      logger,
      workerId: config.workerId,
      pollMs: config.pollMs,
      leaseMs: config.leaseMs,
      version: `agent-${readAgentWorkerVersion()}`,
      forceStop: () => browsers.close(),
      keepProfiles: (profileIds) => browsers.keepOnly(profileIds),
      ...(options.timing ? { timing: options.timing } : {}),
    });
  } finally {
    await browsers.close();
  }
}
