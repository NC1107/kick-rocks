import { statfsSync } from "node:fs";
import { profiles, targets } from "@kickrocks/db";
import { API_ROUTES } from "@kickrocks/shared";
import { and, count, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";
import { nowIso } from "./clock.js";
import { registerRoute } from "./http.js";

type HealthDeps = Pick<AppServices, "db" | "config" | "clock" | "liveness" | "logger">;

/**
 * Commits and removes a row, so a full disk or a locked file shows up here and not in the first
 * request that needs to write. It leaves no row behind.
 */
function databaseIsWritable({ db, clock, logger }: HealthDeps): boolean {
  try {
    db.transaction((tx) => {
      tx.run(
        sql`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('health.probe', 'null', ${nowIso(clock)})`,
      );
      tx.run(sql`DELETE FROM settings WHERE key = 'health.probe'`);
    });
    return true;
  } catch (error) {
    logger.error({ err: error }, "the database write probe failed");
    return false;
  }
}

function freeDiskBytes(dataDir: string): number | null {
  try {
    const { bavail, bsize } = statfsSync(dataDir);
    return Number(bavail) * Number(bsize);
  } catch {
    return null;
  }
}

export function registerHealth(app: FastifyInstance, services: HealthDeps, version: string): void {
  const { db, config, liveness } = services;
  registerRoute(app, API_ROUTES.health, ({ reply }) => {
    const scheduler = liveness.scheduler();
    const writable = databaseIsWritable(services);
    const ok = writable && !scheduler.stalled;
    const body = {
      ok,
      version,
      scheduler: { lastPassAt: scheduler.lastPassAt?.toISOString() ?? null },
      database: { writable },
      disk: { freeBytes: freeDiskBytes(config.dataDir) },
    };
    // A failing check must reach the container healthcheck as a status, not only in the body.
    if (!ok) reply.code(503).send(API_ROUTES.health.response.parse(body));
    return body;
  });

  registerRoute(app, API_ROUTES.status, () => {
    const profileCount = db.select({ n: count() }).from(profiles).get()?.n ?? 0;
    const countKind = (kind: "broker" | "company") =>
      db
        .select({ n: count() })
        .from(targets)
        .where(and(eq(targets.kind, kind), eq(targets.retired, false)))
        .get()?.n ?? 0;
    const brokers = countKind("broker");
    return {
      profiles: profileCount,
      brokers: { available: brokers > 0, total: brokers },
      targets: { brokers, companies: countKind("company") },
    };
  });
}
