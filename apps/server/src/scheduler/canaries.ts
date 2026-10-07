import { recipes, targets, tasks } from "@kickrocks/db";
import { and, eq, gt } from "drizzle-orm";
import type { AppServices } from "../services.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How often a recipe's page is checked for churn. */
export const CANARY_INTERVAL_DAYS = 7;

/**
 * Queues a canary for every approved recipe that has gone a week without one, so a form that
 * changed is noticed before a person's removal fails on it. A recipe a real run exercised
 * recently has been checked already.
 */
export function enqueueDueCanaries(services: AppServices): number {
  const cutoff = new Date(
    services.clock.now().getTime() - CANARY_INTERVAL_DAYS * DAY_MS,
  ).toISOString();
  const candidates = services.db
    .select({ id: recipes.id, lastCheckedAt: recipes.lastCheckedAt })
    .from(recipes)
    .innerJoin(targets, eq(recipes.targetId, targets.id))
    .where(and(eq(recipes.status, "active"), eq(targets.retired, false)))
    .all();
  // Keyed by the dedupe key, which names the recipe, so a canary that never reported back (no
  // worker is running) is not queued again every pass.
  const recent = new Set(
    services.db
      .select({ key: tasks.dedupeKey })
      .from(tasks)
      .where(and(eq(tasks.kind, "canary"), gt(tasks.createdAt, cutoff)))
      .all()
      .map((row) => row.key),
  );

  let queued = 0;
  for (const recipe of candidates) {
    if (recipe.lastCheckedAt && recipe.lastCheckedAt > cutoff) continue;
    if (recent.has(`canary:${recipe.id}`)) continue;
    if (services.dispatch.enqueueCanary(recipe.id).created) queued += 1;
  }
  return queued;
}
