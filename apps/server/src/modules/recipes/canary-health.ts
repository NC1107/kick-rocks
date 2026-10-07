import { type DbHandle, recipes } from "@kickrocks/db";
import { eq } from "drizzle-orm";
import type { AppServices } from "../../services.js";

/**
 * Turns canary tasks into recipe health, through the one rule in `recipeHealth` that real runs
 * share. Handlers run inside the transaction of the task change, so a result and the health it
 * implies commit together.
 */
export function registerCanaryHealth({
  taskHandlers,
  recipeHealth,
}: Pick<AppServices, "taskHandlers" | "recipeHealth">): void {
  function record(recipeId: string, healthy: boolean, tx: DbHandle): void {
    // The recipe may have been removed since the check was queued; a late result is dropped.
    const exists = tx
      .select({ id: recipes.id })
      .from(recipes)
      .where(eq(recipes.id, recipeId))
      .get();
    if (exists) recipeHealth.recordCanary(recipeId, { healthy });
  }

  taskHandlers.on("canary", "completed", ({ task }, tx) => {
    if (!task.result) return;
    const { healthy, missingSelectors } = task.result;
    record(task.payload.recipeId, healthy && missingSelectors.length === 0, tx);
  });

  // A canary whose own steps no longer work means the page changed, the same as a missing
  // selector. A site that is down or a dropped connection says nothing about the recipe.
  taskHandlers.on("canary", "failed", ({ task }, tx) => {
    if (task.failureKind === "recipe") record(task.payload.recipeId, false, tx);
  });
}
