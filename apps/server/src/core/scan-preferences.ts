import { type KickRocksDb, scanPreferences, scans, tasks } from "@kickrocks/db";
import {
  DEFAULT_SCAN_PREFERENCE,
  preferenceBlocks,
  type ScanPreference,
  type ScanPreferenceBody,
  type SkipReason,
} from "@kickrocks/shared";
import { and, eq, inArray } from "drizzle-orm";
import { type Clock, nowIso } from "./clock.js";
import { scanToday } from "./scan-today.js";
import type { SettingsStore } from "./settings.js";
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
  blocks(
    profileId: string,
    targetId: string,
  ): Extract<SkipReason, "site_paused" | "site_skipped"> | null;
}

function toPreference(row: typeof scanPreferences.$inferSelect): ScanPreference {
  return {
    mode: row.mode,
    pausedUntil: row.pausedUntil,
    rescanDays: row.rescanDays,
    autoRescan: row.autoRescan,
    includePastAddresses: row.includePastAddresses,
  };
}

/** A change to another setting of a paused site must not turn its dated pause into an open one. */
function pausedUntilFor(current: ScanPreference, body: ScanPreferenceBody): string | null {
  if (body.mode !== "paused") return null;
  if (body.pausedUntil !== undefined) return body.pausedUntil;
  return current.mode === "paused" ? current.pausedUntil : null;
}

export function createScanPreferences(deps: {
  db: KickRocksDb;
  clock: Clock;
  taskQueue: Pick<TaskQueue, "cancel">;
  settings: Pick<SettingsStore, "get">;
}): ScanPreferences {
  const { db, clock, taskQueue, settings } = deps;
  const today = () => scanToday({ clock, settings });

  const get = (profileId: string, targetId: string): ScanPreference => {
    const row = db
      .select()
      .from(scanPreferences)
      .where(and(eq(scanPreferences.profileId, profileId), eq(scanPreferences.targetId, targetId)))
      .get();
    return row ? toPreference(row) : DEFAULT_SCAN_PREFERENCE;
  };

  /** A scan that is running finishes; one still waiting for its turn, or stopped on a check, is withdrawn. */
  const cancelWaitingScans = (profileId: string, targetId: string, reason: string): void => {
    const waiting = db
      .select({ scanId: scans.id, taskId: tasks.id })
      .from(scans)
      .innerJoin(tasks, eq(scans.taskId, tasks.id))
      .where(
        and(
          eq(scans.profileId, profileId),
          eq(scans.targetId, targetId),
          inArray(tasks.status, ["queued", "blocked"]),
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
        pausedUntil: pausedUntilFor(current, body),
        rescanDays: body.rescanDays === undefined ? current.rescanDays : body.rescanDays,
        autoRescan: body.autoRescan ?? current.autoRescan,
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
        if (next.mode === current.mode) return;
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
