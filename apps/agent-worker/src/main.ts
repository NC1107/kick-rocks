import { createLogger } from "@kickrocks/worker/dist/logger.js";
import { ZodError } from "zod";
import { loadAgentWorkerConfig } from "./config.js";
import { runAgentWorker } from "./worker.js";

async function main() {
  const config = loadAgentWorkerConfig();
  const logger = createLogger(config.logLevel);
  logger.info("agent worker configured", {
    provider: config.provider.kind,
    model: config.provider.model,
    endpoint: config.provider.baseUrl,
    maxSteps: config.limits.maxSteps,
  });

  const shutdown = new AbortController();
  const stop = (name: string) => {
    if (shutdown.signal.aborted) {
      logger.warn(`${name} again, exiting now`);
      process.exit(1);
    }
    logger.info(`${name}, finishing up`);
    shutdown.abort();
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  await runAgentWorker({ config, signal: shutdown.signal, logger });
}

main().catch((error: unknown) => {
  if (error instanceof ZodError) {
    console.error("The agent worker is not configured correctly:");
    for (const issue of error.issues) {
      console.error(`  ${issue.path.join(".") || "environment"}: ${issue.message}`);
    }
  } else {
    console.error(error);
  }
  process.exit(1);
});
