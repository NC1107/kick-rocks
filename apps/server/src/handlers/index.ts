import type { AppServices } from "../services.js";
import { registerConfirmHandlers } from "./confirm-results.js";
import { registerRemovalHandlers } from "./removal-results.js";
import { registerScanHandlers } from "./scan-results.js";

/**
 * Registers the consequences of task results on `services.taskHandlers`. They run after the task
 * audit, inside the transaction of the task change.
 */
export function registerHandlers(services: AppServices): void {
  registerScanHandlers(services);
  registerRemovalHandlers(services);
  registerConfirmHandlers(services);
}
