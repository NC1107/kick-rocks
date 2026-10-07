import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import { hasGeneratedDataset, loadBrokerDataset } from "@kickrocks/brokers";
import { type OpenedDatabase, openDatabase, profiles } from "@kickrocks/db";
import { count } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";

export interface AppContext {
  config: Config;
  database: OpenedDatabase;
  version: string;
}

export interface App {
  server: FastifyInstance;
  close(): Promise<void>;
}

function brokerSummary() {
  if (!hasGeneratedDataset()) return { available: false as const, total: 0 };
  const dataset = loadBrokerDataset();
  return {
    available: true as const,
    total: dataset.brokers.length,
    generatedAt: dataset.generatedAt,
  };
}

export async function buildApp(context: AppContext): Promise<App> {
  const server = Fastify({
    logger: {
      level: context.config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
  });

  server.get("/api/health", async () => {
    const [row] = context.database.db.select({ profiles: count() }).from(profiles).all();
    return {
      ok: true,
      version: context.version,
      profiles: row?.profiles ?? 0,
      brokers: brokerSummary(),
    };
  });

  if (context.config.webDist && existsSync(context.config.webDist)) {
    await server.register(fastifyStatic, {
      root: context.config.webDist,
      wildcard: false,
    });
    server.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return {
    server,
    close: async () => {
      await server.close();
      context.database.close();
    },
  };
}

export function openAppDatabase(config: Config): OpenedDatabase {
  return openDatabase({ dbPath: config.dbPath, keyPath: config.keyPath });
}
