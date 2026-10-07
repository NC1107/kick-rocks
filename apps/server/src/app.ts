import { existsSync } from "node:fs";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { type OpenedDatabase, openDatabase } from "@kickrocks/db";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import { registerGuards } from "./core/guard.js";
import { registerHealth } from "./core/health.js";
import { installErrorHandling } from "./core/http.js";
import { registerModules } from "./modules/index.js";
import { registerScheduler } from "./scheduler/index.js";
import type { AppServices } from "./services.js";

export interface AppContext {
  services: AppServices;
  database: OpenedDatabase;
  version: string;
}

export interface App {
  server: FastifyInstance;
  close(): Promise<void>;
}

const isApiPath = (url: string) =>
  url === "/api" || url.startsWith("/api/") || url === "/mcp" || url.startsWith("/mcp/");

export async function buildApp({ services, database, version }: AppContext): Promise<App> {
  const { config } = services;
  const server = Fastify({ loggerInstance: services.logger });

  installErrorHandling(server);
  await server.register(fastifyCookie);
  registerGuards(server, services);

  await server.register(async (scope) => registerHealth(scope, services, version), {
    prefix: "/api",
  });
  await registerModules(server, services);

  if (config.webDist && existsSync(config.webDist)) {
    await server.register(fastifyStatic, { root: config.webDist, wildcard: false });
  }
  server.setNotFoundHandler((request, reply) => {
    if (isApiPath(request.url) || !config.webDist || !existsSync(config.webDist)) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.sendFile("index.html");
  });

  services.targets.sync();
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
