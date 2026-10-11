import { type ClaimerRow, claimers, type KickRocksDb } from "@kickrocks/db";
import {
  AGENT_LISTED_MS,
  CLAIMER_TOUCH_MS,
  type ModelIdentity,
  type WorkerStatus,
} from "@kickrocks/shared";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { type Clock, nowIso } from "./clock.js";

/** How long a claimer nobody has heard from is kept. */
const CLAIMER_KEPT_MS = 30 * 24 * 60 * 60 * 1000;

export interface WorkerBeat {
  kind: "builtin" | "model";
  workerId: string;
  version: string | null;
  busy: boolean;
  currentTaskId: string | null;
  resultPending: boolean;
  model: ModelIdentity | null;
}

/**
 * Who has called in: the workers that heartbeat and the MCP clients that only show up when they
 * call a tool. A row per kind and worker id, so a second agent worker does not hide the first.
 */
export interface Claimers {
  beat(beat: WorkerBeat): void;
  /** Notes an MCP client's call, writing at most once per {@link CLAIMER_TOUCH_MS} for each id. */
  sawMcp(workerId: string): void;
  /** The worker of this kind that reported last, in the shape the settings view and health read. */
  latestWorker(kind: "builtin" | "model"): WorkerStatus | null;
  /** Agent workers and MCP clients seen within {@link AGENT_LISTED_MS}, newest first. */
  listAgents(): ClaimerRow[];
  lastSeenAt(kind: "model" | "mcp", workerId: string): string | null;
  prune(): number;
}

export function createClaimers(db: KickRocksDb, clock: Clock): Claimers {
  const lastMcpWrite = new Map<string, number>();

  function upsert(row: Omit<ClaimerRow, "firstSeenAt">): void {
    db.insert(claimers)
      .values({ ...row, firstSeenAt: row.lastSeenAt })
      .onConflictDoUpdate({
        target: [claimers.kind, claimers.workerId],
        set: {
          model: row.model,
          version: row.version,
          busy: row.busy,
          currentTaskId: row.currentTaskId,
          resultPending: row.resultPending,
          lastSeenAt: row.lastSeenAt,
        },
      })
      .run();
  }

  return {
    beat(beat) {
      upsert({
        kind: beat.kind,
        workerId: beat.workerId,
        model: beat.model,
        version: beat.version,
        busy: beat.busy,
        currentTaskId: beat.currentTaskId,
        resultPending: beat.resultPending,
        lastSeenAt: nowIso(clock),
      });
    },

    sawMcp(workerId) {
      const now = clock.now().getTime();
      const last = lastMcpWrite.get(workerId);
      if (last !== undefined && now >= last && now - last < CLAIMER_TOUCH_MS) return;
      lastMcpWrite.set(workerId, now);
      upsert({
        kind: "mcp",
        workerId,
        model: null,
        version: null,
        busy: false,
        currentTaskId: null,
        resultPending: false,
        lastSeenAt: nowIso(clock),
      });
    },

    latestWorker(kind) {
      const row = db
        .select()
        .from(claimers)
        .where(eq(claimers.kind, kind))
        .orderBy(desc(claimers.lastSeenAt))
        .get();
      if (!row) return null;
      return {
        workerId: row.workerId,
        version: row.version,
        lastSeenAt: row.lastSeenAt,
        busy: row.busy,
        currentTaskId: row.currentTaskId,
        ...(row.resultPending ? { resultPending: true } : {}),
        ...(row.model ? { model: row.model } : {}),
      };
    },

    listAgents() {
      const since = new Date(clock.now().getTime() - AGENT_LISTED_MS).toISOString();
      return db
        .select()
        .from(claimers)
        .where(gte(claimers.lastSeenAt, since))
        .orderBy(desc(claimers.lastSeenAt))
        .all()
        .filter((row) => row.kind !== "builtin");
    },

    lastSeenAt(kind, workerId) {
      return (
        db
          .select({ at: claimers.lastSeenAt })
          .from(claimers)
          .where(and(eq(claimers.kind, kind), eq(claimers.workerId, workerId)))
          .get()?.at ?? null
      );
    },

    prune() {
      const cutoff = new Date(clock.now().getTime() - CLAIMER_KEPT_MS).toISOString();
      return db.delete(claimers).where(lt(claimers.lastSeenAt, cutoff)).run().changes;
    },
  };
}
