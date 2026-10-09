import { readFileSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { profiles, targets } from "@kickrocks/db";
import { API_ROUTES, type InstanceHealth } from "@kickrocks/shared";
import { and, count, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";
import { nowIso } from "./clock.js";
import { registerRoute } from "./http.js";

type HealthDeps = Pick<AppServices, "db" | "config" | "clock" | "liveness" | "logger">;

/**
 * Commits and removes a row, so a locked file or a read-only volume shows up here and not in the
 * first request that needs to write. It leaves no row behind.
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

/** The file install.sh leaves in the data directory after a backup that read back whole. */
export const BACKUP_MARKER = "last-backup";

/** A daily scheduled backup plus a missed day, so one failed run does not raise the alarm. */
export const BACKUP_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

function lastVerifiedBackup(dataDir: string): string | null {
  try {
    const at = new Date(readFileSync(join(dataDir, BACKUP_MARKER), "utf8").trim());
    return Number.isNaN(at.getTime()) ? null : at.toISOString();
  } catch {
    return null;
  }
}

/**
 * Below this a write may still fit, as SQLite takes small ones into the last pages of a full
 * file, so the write probe alone would stay green until the disk was already out of room.
 */
export const DISK_FLOOR_BYTES = 64 * 1024 * 1024;

/** Long enough that a page polling the health check does not turn each poll into a disk write. */
const PROBE_TTL_MS = 30_000;

/** Reads the database and disk at most once in {@link PROBE_TTL_MS}, however often it is asked. */
function createStorageProbe(deps: HealthDeps) {
  let cached: { at: number; writable: boolean; freeBytes: number | null } | null = null;
  return () => {
    const now = deps.clock.now().getTime();
    if (!cached || now - cached.at >= PROBE_TTL_MS) {
      cached = {
        at: now,
        writable: databaseIsWritable(deps),
        freeBytes: freeDiskBytes(deps.config.dataDir),
      };
    }
    return cached;
  };
}

export function registerHealth(app: FastifyInstance, services: HealthDeps, version: string): void {
  const { db, liveness } = services;
  const probe = createStorageProbe(services);

  const inspect = (): { ok: boolean; health: InstanceHealth } => {
    const scheduler = liveness.scheduler();
    const { writable, freeBytes } = probe();
    const lastVerifiedAt = lastVerifiedBackup(services.config.dataDir);
    const backupAge = lastVerifiedAt
      ? services.clock.now().getTime() - new Date(lastVerifiedAt).getTime()
      : null;
    const low = freeBytes !== null && freeBytes < DISK_FLOOR_BYTES;
    return {
      ok: writable && !low && !scheduler.stalled && !scheduler.sendingStalled,
      health: {
        scheduler: {
          lastPassAt: scheduler.lastPassAt?.toISOString() ?? null,
          stalled: scheduler.stalled,
          sendingSince: scheduler.sendingSince?.toISOString() ?? null,
          sendingStalled: scheduler.sendingStalled,
        },
        database: { writable },
        disk: { freeBytes, low },
        backup: {
          lastVerifiedAt,
          stale: backupAge === null || backupAge > BACKUP_STALE_AFTER_MS,
        },
      },
    };
  };

  registerRoute(app, API_ROUTES.health, ({ reply }) => {
    const body = { ok: inspect().ok, version };
    // A failing check must reach the container healthcheck as a status, not only in the body.
    if (!body.ok) reply.code(503).send(API_ROUTES.health.response.parse(body));
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
      health: inspect().health,
    };
  });
}
