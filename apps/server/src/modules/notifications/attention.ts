import { mailboxes, matches, recipes, requests } from "@kickrocks/db";
import { BROWSER_TASK_KINDS, type NotificationCategory } from "@kickrocks/shared";
import { and, eq, isNotNull, or } from "drizzle-orm";
import type { AppServices } from "../../services.js";

export interface AttentionItem {
  category: NotificationCategory;
  /** Stable for as long as the item stays open, so it is announced once. */
  key: string;
  /** The page in the app where the person deals with it. */
  path: string;
}

/** Longer than a worker restart or a slow heartbeat, short enough that the person hears the same hour. */
const WORKER_SILENT_MS = 5 * 60 * 1000;

/** Browser work only moves when a worker is polling, so work waiting on a silent worker never ends by itself. */
function workerOfflineWithWorkWaiting(services: AppServices): boolean {
  const { config, settings, taskQueue, clock } = services;
  if (config.workerToken === null) return false;
  if (taskQueue.list({ status: "queued", kinds: BROWSER_TASK_KINDS }).length === 0) return false;
  const newest = Math.max(
    ...(["builtin", "model"] as const).map((claimer) => {
      const seen = settings.get(`worker.status.${claimer}`)?.lastSeenAt;
      return seen ? Date.parse(seen) : Number.NEGATIVE_INFINITY;
    }),
  );
  return clock.now().getTime() - newest > WORKER_SILENT_MS;
}

/**
 * Everything that waits on the person right now, one item per thing. Reading current state and
 * comparing it with what was announced means no code path that blocks a task has to remember to
 * notify, and an item that is resolved and later happens again is announced again once the push
 * cooldown has passed.
 */
export function collectAttention(services: AppServices): AttentionItem[] {
  const { db, taskQueue } = services;
  const items: AttentionItem[] = [];

  for (const task of taskQueue.list({ status: "blocked" })) {
    items.push({ category: "blocked_task", key: `task:${task.id}`, path: "/review" });
  }
  for (const row of db
    .select({ id: requests.id })
    .from(requests)
    .where(eq(requests.status, "needs_verification"))
    .all()) {
    items.push({ category: "verification", key: `verification:${row.id}`, path: "/review" });
  }
  for (const row of db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.decision, "pending"))
    .all()) {
    items.push({ category: "match", key: `match:${row.id}`, path: "/review" });
  }
  for (const row of db
    .select({ id: mailboxes.id, profileId: mailboxes.profileId })
    .from(mailboxes)
    .where(or(isNotNull(mailboxes.lastError), isNotNull(mailboxes.lastSendError)))
    .all()) {
    items.push({
      category: "mailbox",
      key: `mailbox:${row.id}`,
      path: `/profiles/${row.profileId}/mailbox`,
    });
  }
  for (const row of db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.health, "broken"), eq(recipes.status, "active")))
    .all()) {
    items.push({ category: "recipe", key: `recipe:${row.id}`, path: "/settings/recipes" });
  }
  if (workerOfflineWithWorkWaiting(services)) {
    items.push({ category: "worker", key: "worker:offline", path: "/settings/agents" });
  }
  return items;
}
