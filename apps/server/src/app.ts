import { existsSync } from "node:fs";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { type OpenedDatabase, openDatabase } from "@kickrocks/db";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import type { Config } from "./config.js";
import { registerGuards } from "./core/guard.js";
import { registerHealth } from "./core/health.js";
import { createHostPolicy } from "./core/hosts.js";
import { frameworkErrorResponse, installErrorHandling } from "./core/http.js";
import { registerModules } from "./modules/index.js";
import { registerScheduler } from "./scheduler/index.js";
import type { AppServices } from "./services.js";
import { webAssetOptions } from "./web-assets.js";

interface AppContext {
  services: AppServices;
  database: OpenedDatabase;
  version: string;
}

interface App {
  server: FastifyInstance;
  close(): Promise<void>;
}

const isApiPath = (url: string) =>
  url === "/api" || url.startsWith("/api/") || url === "/mcp" || url.startsWith("/mcp/");

/**
 * Content-Security-Policy for the SPA and the API. Everything is served from this origin, nothing
 * may frame it, and screenshots arrive as images from the same origin or as blob and data URLs.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

function setSecurityHeaders(reply: FastifyReply): void {
  reply
    .header("x-content-type-options", "nosniff")
    .header("referrer-policy", "no-referrer")
    .header("x-frame-options", "DENY")
    .header("content-security-policy", CONTENT_SECURITY_POLICY);
}

function registerSecurityHeaders(server: FastifyInstance): void {
  server.addHook("onSend", async (_request, reply) => setSecurityHeaders(reply));
}

/**
 * Fastify answers a request it cannot route, such as a malformed URL, before any hook runs, so
 * its raw error and the missing security headers need this handler.
 */
function answerFrameworkError(error: FastifyError, _request: FastifyRequest, reply: FastifyReply) {
  setSecurityHeaders(reply);
  const { status, body } = frameworkErrorResponse(error);
  return reply.code(status).send(body);
}

export async function buildApp({ services, database, version }: AppContext): Promise<App> {
  const { config } = services;
  const { trustProxy } = config;
  const server = Fastify({
    loggerInstance: services.logger,
    frameworkErrors: answerFrameworkError,
    trustProxy: typeof trustProxy === "number" ? (_address, hop) => hop < trustProxy : trustProxy,
  });

  installErrorHandling(server);
  registerSecurityHeaders(server);
  await server.register(fastifyCookie);
  registerGuards(server, services, createHostPolicy(config));

  // Modules may register startup steps that store rows pointing at targets, so the targets come first.
  services.targets.sync();

  await server.register(async (scope) => registerHealth(scope, services, version), {
    prefix: "/api",
  });
  await registerModules(server, services);
  await services.startup.run();

  if (config.webDist && existsSync(config.webDist)) {
    await server.register(fastifyStatic, webAssetOptions(config.webDist));
  }
  server.setNotFoundHandler((request, reply) => {
    if (isApiPath(request.url) || !config.webDist || !existsSync(config.webDist)) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.sendFile("index.html");
  });

  registerScheduler(server, services);

  return {
    server,
    close: async () => {
      await server.close();
      database.close();
    },
  };
}

export function openAppDatabase(config: Config): OpenedDatabase {
  return openDatabase({ dbPath: config.dbPath, keyPath: config.keyPath });
}
