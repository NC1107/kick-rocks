import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";

/**
 * A feature module. It receives the shared services as an argument and never builds its own.
 * The foundation registers it in its own encapsulated scope with the prefix /api (or /mcp).
 *
 * Startup order, in `buildApp`: the datasets are synced into `targets`, then every module plugin
 * is registered, then the steps modules added with `services.startup.onReady(name, step)` run in
 * order, then the scheduler starts. A module that has to store rows that point at targets, such as
 * recipes, does it in a startup step and never when its plugin registers, because on the first
 * boot the plugin runs while a step does not.
 *
 * Register routes with `registerRoute` from `core/http.ts` so the route table decides who may call
 * them: the guard reads it, and an `/api` route registered any other way needs a session.
 */
export type ModulePlugin = (app: FastifyInstance, services: AppServices) => void | Promise<void>;
