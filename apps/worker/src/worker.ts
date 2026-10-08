import { WorkerApiClient } from "./api-client.js";
import { type BrowserLauncher, createProfileBrowsers } from "./browser.js";
import { type ClaimLoopContext, runClaimLoop } from "./claim-loop.js";
import type { WorkerConfig } from "./config.js";
import { createExecutor, type Runners } from "./executor.js";
import type { Logger } from "./logger.js";
import { readWorkerVersion } from "./version.js";

export interface WorkerOptions {
  config: WorkerConfig;
  signal: AbortSignal;
  logger: Logger;
  /** Replaced in tests. */
  launcher?: BrowserLauncher;
  runners?: Runners;
  timing?: ClaimLoopContext["timing"];
}

/** Builds the worker from its config and runs it until the signal aborts, then closes the browser. */
export async function runWorker(options: WorkerOptions): Promise<void> {
  const { config, signal, logger } = options;
  const client = new WorkerApiClient({
    serverUrl: config.serverUrl,
    token: config.token,
    workerId: config.workerId,
  });
  const browser = createProfileBrowsers(
    {
      profileDir: config.chromeProfileDir,
      headless: config.headless,
      noSandbox: config.noSandbox,
      proxyServer: config.proxyServer,
      executablePath: config.chromeExecutable,
    },
    logger,
    options.launcher,
  );
  const executor = createExecutor({
    openPage: (profileId, proxy) => browser.newPage(profileId, proxy),
    pace: config.pace,
    allowHttp: config.allowHttp,
    logger,
    ...(options.runners ? { runners: options.runners } : {}),
  });
  try {
    await runClaimLoop({
      config,
      client,
      signal,
      executor,
      logger,
      version: readWorkerVersion(),
      forceStop: () => browser.close(),
      keepProfiles: (profileIds) => browser.keepOnly(profileIds),
      ...(options.timing ? { timing: options.timing } : {}),
    });
  } finally {
    await browser.close();
  }
}
