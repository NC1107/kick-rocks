import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";
import { createScheduler } from "./scheduler.js";

export { createScheduler } from "./scheduler.js";

/** Docker kills a container ten seconds after SIGTERM, so a send in flight gets less than that before it is abandoned. */
export const SHUTDOWN_GRACE_MS = 7_000;

/**
 * Starts the scheduler loop with the server and stops it on close. It does nothing when
 * `KICKROCKS_SCHEDULER=off`, which is how tests and one-off tools run.
 */
export function registerScheduler(
  app: FastifyInstance,
  services: AppServices,
  { shutdownGraceMs = SHUTDOWN_GRACE_MS }: { shutdownGraceMs?: number } = {},
): void {
  if (!services.config.schedulerEnabled) return;
  const scheduler = createScheduler(services);
  scheduler.start();
  app.addHook("onClose", async () => {
    await scheduler.stop({ graceMs: shutdownGraceMs });
  });
}
