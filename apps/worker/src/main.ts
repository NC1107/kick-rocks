import { ZodError } from "zod";
import { loadWorkerConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { runWorker } from "./worker.js";

async function main() {
  const config = loadWorkerConfig();
  const logger = createLogger(config.logLevel);

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

  await runWorker({ config, signal: shutdown.signal, logger });
}

main().catch((error: unknown) => {
  if (error instanceof ZodError) {
    console.error("The worker is not configured correctly:");
    for (const issue of error.issues) {
      console.error(`  ${issue.path.join(".") || "environment"}: ${issue.message}`);
    }
  } else {
    console.error(error);
  }
  process.exit(1);
});
