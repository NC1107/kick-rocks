import { type KickRocksDb, recipes } from "@kickrocks/db";
import type { ApprovedRecipes } from "@kickrocks/shared";
import { and, asc, eq, inArray } from "drizzle-orm";

/** Past this many targets a single scan of the active recipes is cheaper than a long id list. */
const ID_LIST_LIMIT = 200;

export const NO_RECIPES: ApprovedRecipes = { scan: null, remove: null };

/**
 * The health of each target's newest approved (active) recipe per purpose. A proposal or a rejected
 * recipe never runs, so it does not count. Read on every call so an approval or a health change
 * moves a target between difficulties at once.
 */
export function approvedRecipesOf(
  db: KickRocksDb,
  targetIds: readonly string[],
): Map<string, ApprovedRecipes> {
  const result = new Map<string, ApprovedRecipes>();
  if (targetIds.length === 0) return result;
  const scoped = targetIds.length <= ID_LIST_LIMIT;
  const rows = db
    .select({ targetId: recipes.targetId, purpose: recipes.purpose, health: recipes.health })
    .from(recipes)
    .where(
      and(
        eq(recipes.status, "active"),
        scoped ? inArray(recipes.targetId, [...targetIds]) : undefined,
      ),
    )
    .orderBy(asc(recipes.version))
    .all();
  // Ascending by version, so the last row written for a purpose is the newest.
  for (const row of rows) {
    const entry = result.get(row.targetId) ?? { scan: null, remove: null };
    entry[row.purpose] = row.health;
    result.set(row.targetId, entry);
  }
  return result;
}
