import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";

/**
 * A feature module. It receives the shared services as an argument and never builds its own.
 * The foundation registers it in its own encapsulated scope with the prefix /api (or /mcp).
 */
export type ModulePlugin = (app: FastifyInstance, services: AppServices) => void | Promise<void>;
