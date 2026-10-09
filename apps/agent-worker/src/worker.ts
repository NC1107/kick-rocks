import { HUMAN_PACE, INSTANT_PACE, type Pace } from "@kickrocks/recipes";
import { WorkerApiClient } from "@kickrocks/worker/dist/api-client.js";
import {
  type BrowserLauncher,
  createProfileBrowsers,
  ProxyConflictError,
} from "@kickrocks/worker/dist/browser.js";
import { describeError, type Logger } from "@kickrocks/worker/dist/logger.js";
import type { Page } from "playwright";
import { runAgentTask } from "./agent.js";
import type { AgentWorkerConfig } from "./config.js";
import { type AgentExecutor, type LoopContext, runLoop } from "./loop.js";
import { modelIdentitySource } from "./model-identity.js";
import type { SendsApi } from "./outbound/held.js";
import type { ModelProvider } from "./provider.js";
import { createProvider } from "./providers/index.js";
import { readAgentWorkerVersion } from "./version.js";

/** A browser that will not start is the worker's problem, not the task's. */
const BROWSER_UNAVAILABLE_RETRY_MS = 60_000;

interface AgentWorkerOptions {
  config: AgentWorkerConfig;
  signal: AbortSignal;
  logger: Logger;
  /** Replaced in tests. */
  launcher?: BrowserLauncher;
  provider?: ModelProvider;
  fetch?: typeof fetch;
  timing?: LoopContext["timing"];
  challengeGraceMs?: number;
  /** Shortens how long a send waits for a person. Only a test that has nobody to answer wants it. */
  holdMsCap?: number;
  /** Cuts the screenshot of a held send down sooner, for a test of the oversized page. */
  maxScreenshotBytes?: number;
}

/** The calls the outgoing gate makes for one task, bound to it. */
function sendsFor(api: WorkerApiClient, taskId: string, attempt: number): SendsApi {
  return {
    registerSends: (items) => api.registerSends(taskId, attempt, items),
    awaitDecision: (sendId, waitMs, signal) => api.awaitDecision(taskId, sendId, waitMs, signal),
    releaseSend: (sendId, request) => api.releaseSend(taskId, sendId, request),
    sendResult: (sendId, outcome) => api.sendResult(taskId, sendId, outcome),
  };
}

/** Builds the agent worker from its config and runs it until the signal aborts, then closes the browser. */
export async function runAgentWorker(options: AgentWorkerOptions): Promise<void> {
  const { config, signal, logger } = options;
  const api = new WorkerApiClient({
    serverUrl: config.serverUrl,
    token: config.token,
    workerId: config.workerId,
    claimer: "model",
    model: modelIdentitySource(config.provider, options.fetch ? { fetch: options.fetch } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const provider = options.provider ?? createProvider(config.provider);
  const browsers = createProfileBrowsers(
    {
      profileDir: config.chromeProfileDir,
      headless: config.headless,
      noSandbox: config.noSandbox,
      executablePath: config.chromeExecutable,
      blockSharedWorkers: true,
    },
    logger,
    options.launcher,
  );
  const pace: Pace = config.pace === "instant" ? INSTANT_PACE : HUMAN_PACE;

  const closers = new Set<() => Promise<void>>();
  /** The browser closes only after every gate has failed what it still holds. */
  const closeGatesThenBrowsers = async (): Promise<void> => {
    await Promise.allSettled([...closers].map((close) => close()));
    await browsers.close();
  };

  const executor: AgentExecutor = async (task, runSignal, progress) => {
    let page: Page;
    try {
      page = await browsers.newPage(task.profileId ?? null, task.proxyUrl ?? null);
    } catch (error) {
      if (error instanceof ProxyConflictError) {
        return {
          kind: "fail",
          report: { error: error.message, retryable: false, kind: "internal" },
        };
      }
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
        registerClose: (close) => {
          closers.add(close);
          return () => closers.delete(close);
        },
        ...(progress ? { onMayHaveSubmitted: progress.mayHaveSubmitted } : {}),
        sends: sendsFor(api, task.id, task.attempt),
        ...(options.holdMsCap === undefined ? {} : { holdMsCap: options.holdMsCap }),
        ...(options.maxScreenshotBytes === undefined
          ? {}
          : { maxScreenshotBytes: options.maxScreenshotBytes }),
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
      forceStop: closeGatesThenBrowsers,
      keepProfiles: (profileIds) => browsers.keepOnly(profileIds),
      ...(options.timing ? { timing: options.timing } : {}),
    });
  } finally {
    await closeGatesThenBrowsers();
  }
}
