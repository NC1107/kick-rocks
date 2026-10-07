import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";

/**
 * Starts the scheduler loop with the server and stops it on close. Module D2 fills it in; it must
 * do nothing when `services.config.schedulerEnabled` is false.
 */
export function registerScheduler(_app: FastifyInstance, _services: AppServices): void {}
