import { type KickRocksDb, recipes } from "@kickrocks/db";
import type { ApprovedRecipes } from "@kickrocks/shared";
import { and, asc, eq, inArray } from "drizzle-orm";

/** Past this many targets a single scan of the active recipes is cheaper than a long id list. */
const ID_LIST_LIMIT = 200;

export const NO_RECIPES: ApprovedRecipes = { scan: null, remove: null };

/**
 * The health of each target's newest approved (active) recipe per purpose that is not broken, as the
 * runtime picks it, or "broken" when every active recipe for the purpose is. A proposal or a rejected
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
  // Ascending by version, so a later usable row replaces an earlier one. A broken row only counts
  // while nothing usable has been seen, which leaves "broken" for purposes where every version is.
  for (const row of rows) {
    const entry = result.get(row.targetId) ?? { scan: null, remove: null };
    if (row.health !== "broken") entry[row.purpose] = row.health;
    else entry[row.purpose] ??= "broken";
    result.set(row.targetId, entry);
  }
  return result;
}
