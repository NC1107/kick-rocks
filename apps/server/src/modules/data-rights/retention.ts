import { type KickRocksDb, messages } from "@kickrocks/db";
import { and, isNotNull, lt, or, sql } from "drizzle-orm";
import type { Clock } from "../../core/clock.js";
import type { SettingsStore } from "../../core/settings.js";
import type { TaskQueue } from "../../core/task-queue.js";
import { compactDatabase } from "./compact.js";

export interface RetentionDeps {
  db: KickRocksDb;
  clock: Clock;
  settings: SettingsStore;
  taskQueue: TaskQueue;
}

export interface RetentionResult {
  screenshots: number;
  messages: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const cutoff = (clock: Clock, days: number): Date =>
  new Date(clock.now().getTime() - days * DAY_MS);

/**
 * Blanks the text of mail that has been dealt with. Rows stay, because the unique index on the
 * mailbox UID is what stops the next poll from importing the same message again, and the sender,
 * subject, and outcome are the history of the request.
 */
function scrubMessageText(db: KickRocksDb, before: Date): number {
  return db
    .update(messages)
    .set({ text: null, snippet: null, rationale: null, links: [] })
    .where(
      and(
        sql`${messages.reviewed} = 1`,
        lt(messages.receivedAt, before.toISOString()),
        or(
          isNotNull(messages.text),
          isNotNull(messages.snippet),
          isNotNull(messages.rationale),
          sql`${messages.links} != '[]'`,
        ),
      ),
    )
    .run().changes;
}

const COMPACT_FREE_BYTES = 16 * 1024 * 1024;
const COMPACT_FREE_FRACTION = 0.1;

/**
 * VACUUM blocks the event loop and, with temp_store=MEMORY, holds a copy of the whole file in
 * RAM, so the hourly job waits until enough of the file is free space to justify it.
 */
function hasMeaningfulFreeSpace(db: KickRocksDb): boolean {
  const pragma = (name: string) => db.$client.pragma(name, { simple: true }) as number;
  const free = pragma("freelist_count");
  return (
    free * pragma("page_size") > COMPACT_FREE_BYTES ||
    free > pragma("page_count") * COMPACT_FREE_FRACTION
  );
}

export interface RetentionOptions {
  /**
   * `always` compacts whenever something was removed, for a person who just changed a window and
   * expects the old bytes gone now. `when-worthwhile` is for the scheduled run.
   */
  compact?: "always" | "when-worthwhile";
}

/** Applies the retention settings once. The file is compacted only when something was removed. */
export function applyRetention(
  { db, clock, settings, taskQueue }: RetentionDeps,
  { compact = "always" }: RetentionOptions = {},
): RetentionResult {
  const { messageDays, screenshotDays } = settings.get("retention");
  const result: RetentionResult = {
    screenshots:
      screenshotDays === null ? 0 : taskQueue.purgeArtifacts(cutoff(clock, screenshotDays)),
    messages: messageDays === null ? 0 : scrubMessageText(db, cutoff(clock, messageDays)),
  };
  const removed = result.screenshots > 0 || result.messages > 0;
  if (removed && (compact === "always" || hasMeaningfulFreeSpace(db))) compactDatabase(db);
  return result;
}
