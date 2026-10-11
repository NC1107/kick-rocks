import { type KickRocksDb, scanPreferences, scans, tasks } from "@kickrocks/db";
import {
  DEFAULT_SCAN_PREFERENCE,
  type ScanPreference,
  type ScanPreferenceBody,
  type SkipReason,
} from "@kickrocks/shared";
import { and, eq, inArray } from "drizzle-orm";
import { type Clock, nowIso } from "./clock.js";
import type { TaskQueue } from "./task-queue.js";

export const CANCELLED_BY_PAUSE = "Cancelled because you paused this site";
export const CANCELLED_BY_SKIP = "Cancelled because you skipped this site";

export interface ScanPreferences {
  get(profileId: string, targetId: string): ScanPreference;
  /** Every preference a profile has chosen, keyed by target id. */
  forProfile(profileId: string): Map<string, ScanPreference>;
  /** Sets a pair's preference. Pausing or skipping cancels scans still waiting to start. */
  set(profileId: string, targetId: string, body: ScanPreferenceBody): ScanPreference;
  /**
   * Why an automatic or bulk scan leaves this pair alone, or null when it may go. A pause that
   * has reached its date no longer counts.
   */
  blocks(profileId: string, targetId: string): Extract<SkipReason, "site_paused" | "site_skipped"> | null;
}

/** Whether a stored preference stops scanning on a day, given as YYYY-MM-DD. */
export function preferenceBlocks(
  preference: ScanPreference,
  today: string,
): "site_paused" | "site_skipped" | null {
  if (preference.mode === "skipped") return "site_skipped";
  if (preference.mode === "paused") {
    return preference.pausedUntil === null || today < preference.pausedUntil ? "site_paused" : null;
  }
  return null;
}

function toPreference(row: typeof scanPreferences.$inferSelect): ScanPreference {
  return {
    mode: row.mode,
    pausedUntil: row.pausedUntil,
    rescanDays: row.rescanDays,
    includePastAddresses: row.includePastAddresses,
  };
}

export function createScanPreferences(deps: {
  db: KickRocksDb;
  clock: Clock;
  taskQueue: Pick<TaskQueue, "cancel">;
}): ScanPreferences {
  const { db, clock, taskQueue } = deps;
  const today = () => clock.now().toISOString().slice(0, 10);

  const get = (profileId: string, targetId: string): ScanPreference => {
    const row = db
      .select()
      .from(scanPreferences)
      .where(and(eq(scanPreferences.profileId, profileId), eq(scanPreferences.targetId, targetId)))
      .get();
    return row ? toPreference(row) : DEFAULT_SCAN_PREFERENCE;
  };

  /** A scan that is running finishes; one still waiting for its turn is withdrawn. */
  const cancelWaitingScans = (profileId: string, targetId: string, reason: string): void => {
    const waiting = db
      .select({ scanId: scans.id, taskId: tasks.id })
      .from(scans)
      .innerJoin(tasks, eq(scans.taskId, tasks.id))
      .where(
        and(
          eq(scans.profileId, profileId),
          eq(scans.targetId, targetId),
          inArray(tasks.status, ["queued"]),
        ),
      )
      .all();
    for (const { scanId, taskId } of waiting) {
      taskQueue.cancel(taskId, "user");
      db.update(scans)
        .set({ finishedAt: nowIso(clock), error: reason })
        .where(eq(scans.id, scanId))
        .run();
    }
  };

  return {
    get,

    forProfile(profileId) {
      return new Map(
        db
          .select()
          .from(scanPreferences)
          .where(eq(scanPreferences.profileId, profileId))
          .all()
          .map((row) => [row.targetId, toPreference(row)]),
      );
    },

    set(profileId, targetId, body) {
      const current = get(profileId, targetId);
      const next: ScanPreference = {
        mode: body.mode,
        pausedUntil: body.mode === "paused" ? (body.pausedUntil ?? null) : null,
        rescanDays: body.rescanDays === undefined ? current.rescanDays : body.rescanDays,
        includePastAddresses: body.includePastAddresses ?? current.includePastAddresses,
      };
      db.transaction(() => {
        db.insert(scanPreferences)
          .values({ profileId, targetId, ...next, updatedAt: nowIso(clock) })
          .onConflictDoUpdate({
            target: [scanPreferences.profileId, scanPreferences.targetId],
            set: { ...next, updatedAt: nowIso(clock) },
          })
          .run();
        if (next.mode === "paused") cancelWaitingScans(profileId, targetId, CANCELLED_BY_PAUSE);
        if (next.mode === "skipped") cancelWaitingScans(profileId, targetId, CANCELLED_BY_SKIP);
      });
      return next;
    },

    blocks(profileId, targetId) {
      return preferenceBlocks(get(profileId, targetId), today());
    },
  };
}
