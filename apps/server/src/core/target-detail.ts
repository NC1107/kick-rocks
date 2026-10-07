import type { KickRocksDb } from "@kickrocks/db";
import { recipes } from "@kickrocks/db";
import type { TargetDetail } from "@kickrocks/shared";
import { desc, eq } from "drizzle-orm";
import type { TargetsService } from "./targets.js";

/** A target with its contacts, where it came from, and the recipes that exist for it. */
export function targetDetail(
  { db, targets }: { db: KickRocksDb; targets: TargetsService },
  targetId: string,
): TargetDetail {
  const row = targets.getOrThrow(targetId);
  const verifiedAt = "verifiedAt" in row.data ? row.data.verifiedAt : null;
  const recipeRows = db
    .select()
    .from(recipes)
    .where(eq(recipes.targetId, targetId))
    .orderBy(recipes.purpose, desc(recipes.version))
    .all();
  return {
    ...targets.toSummary(row),
    privacyEmail: row.privacyEmail,
    region: row.region,
    notes: row.data.notes,
    sources: row.data.sources,
    verifiedAt,
    recipes: recipeRows.map((recipe) => ({
      id: recipe.id,
      purpose: recipe.purpose,
      version: recipe.version,
      source: recipe.source,
      status: recipe.status,
      health: recipe.health,
    })),
  };
}
