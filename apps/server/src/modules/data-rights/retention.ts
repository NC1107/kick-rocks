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

/** Applies the retention settings once. The file is compacted only when something was removed. */
export function applyRetention({ db, clock, settings, taskQueue }: RetentionDeps): RetentionResult {
  const { messageDays, screenshotDays } = settings.get("retention");
  const result: RetentionResult = {
    screenshots:
      screenshotDays === null ? 0 : taskQueue.purgeArtifacts(cutoff(clock, screenshotDays)),
    messages: messageDays === null ? 0 : scrubMessageText(db, cutoff(clock, messageDays)),
  };
  if (result.screenshots > 0 || result.messages > 0) compactDatabase(db);
  return result;
}
