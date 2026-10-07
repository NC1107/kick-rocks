import { type KickRocksDb, type RecipeRow, recipes } from "@kickrocks/db";
import { eq } from "drizzle-orm";
import { type Clock, nowIso } from "./clock.js";
import { notFound } from "./errors.js";

/** Consecutive failed runs after which a recipe is considered broken. */
export const BROKEN_AFTER_FAILURES = 3;

/**
 * The one place that decides what a run or a canary says about a recipe, so the handlers that
 * count real runs and the module that applies canary results cannot disagree.
 */
export interface RecipeHealthService {
  /** A real run finished. Success clears the count; the third failure in a row marks it broken. */
  recordRun(recipeId: string, outcome: { ok: boolean }): RecipeRow;
  /** A canary check finished. A missing selector means the page changed, so it is broken at once. */
  recordCanary(recipeId: string, outcome: { healthy: boolean }): RecipeRow;
}

export function createRecipeHealth(db: KickRocksDb, clock: Clock): RecipeHealthService {
  function apply(
    recipeId: string,
    change: (row: RecipeRow) => Pick<RecipeRow, "health" | "failureCount">,
  ): RecipeRow {
    return db.transaction((tx) => {
      const row = tx.select().from(recipes).where(eq(recipes.id, recipeId)).get();
      if (!row) throw notFound(`Recipe ${recipeId} not found`, "recipe_not_found");
      return tx
        .update(recipes)
        .set({ ...change(row), lastCheckedAt: nowIso(clock) })
        .where(eq(recipes.id, recipeId))
        .returning()
        .get();
    });
  }

  return {
    recordRun(recipeId, { ok }) {
      return apply(recipeId, (row) => {
        if (ok) return { health: "healthy", failureCount: 0 };
        const failureCount = row.failureCount + 1;
        return {
          health: failureCount >= BROKEN_AFTER_FAILURES ? "broken" : row.health,
          failureCount,
        };
      });
    },

    recordCanary(recipeId, { healthy }) {
      return apply(recipeId, (row) =>
        healthy
          ? { health: "healthy", failureCount: 0 }
          : { health: "broken", failureCount: row.failureCount + 1 },
      );
    },
  };
}
