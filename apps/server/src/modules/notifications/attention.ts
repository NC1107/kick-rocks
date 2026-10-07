import { mailboxes, matches, recipes, requests } from "@kickrocks/db";
import type { NotificationCategory } from "@kickrocks/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import type { AppServices } from "../../services.js";

export interface AttentionItem {
  category: NotificationCategory;
  /** Stable for as long as the item stays open, so it is announced once. */
  key: string;
  /** The page in the app where the person deals with it. */
  path: string;
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
    .where(isNotNull(mailboxes.lastError))
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
  return items;
}
