import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";
import { createScheduler } from "./scheduler.js";

export { createScheduler, type Scheduler, type SchedulerOptions } from "./scheduler.js";

/**
 * Starts the scheduler loop with the server and stops it on close. It does nothing when
 * `KICKROCKS_SCHEDULER=off`, which is how tests and one-off tools run.
 */
export function registerScheduler(app: FastifyInstance, services: AppServices): void {
  if (!services.config.schedulerEnabled) return;
  const scheduler = createScheduler(services);
  scheduler.start();
  app.addHook("onClose", async () => {
    await scheduler.stop();
  });
}
