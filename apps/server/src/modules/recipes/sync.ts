import { recipes, targets } from "@kickrocks/db";
import { loadRecipes, type RecipeOrigin } from "@kickrocks/recipes";
import { type ApiIssue, Recipe } from "@kickrocks/shared";
import { and, eq, inArray } from "drizzle-orm";
import { nowIso } from "../../core/clock.js";
import { type RecipeTarget, recipeTargetProblems } from "../../core/recipe-catalog.js";
import type { AppServices } from "../../services.js";
import { behaviour } from "./behaviour.js";

export interface SkippedRecipe {
  /** The recipe id, or the file when it could not even be read. */
  subject: string;
  problems: string[];
}

export interface RecipeSyncReport {
  added: string[];
  updated: string[];
  unchanged: number;
  retired: string[];
  /** Everything that was left out, so a typo or a stale broker id is never silent. */
  skipped: SkippedRecipe[];
}

type SyncServices = Pick<AppServices, "db" | "clock" | "logger" | "config">;

const SOURCE_OF_ORIGIN = { bundled: "bundled", extra: "user" } as const satisfies Record<
  RecipeOrigin,
  "bundled" | "user"
>;

const describeIssue = (issue: ApiIssue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`;

/**
 * Where a recipe file starts out. Extra recipes are code the person installed, so they are active
 * at once. A bundled recipe is active only when its author saw the whole flow through, and waits
 * for a person to approve it otherwise, so a guessed script never runs on its own.
 */
function initialStatus(recipe: Recipe, origin: RecipeOrigin): "active" | "pending_review" {
  return origin === "bundled" && recipe.liveStatus !== "verified" ? "pending_review" : "active";
}

/**
 * Makes the `recipes` table say what the recipe files say. A proposal waits for review and is
 * never touched here, unless a file with the same id ships, in which case the file replaces it.
 * A bundled recipe that a person approved stays approved until its script changes.
 *
 * A recipe whose broker is not in the dataset, or whose pages are on another site, is reported and
 * left out. A recipe whose file is gone is retired, but only when every file loaded cleanly, so a
 * typo in one file does not switch off the rest of the catalog.
 */
export function syncRecipes(
  { db, clock, logger, config }: SyncServices,
  options: { bundledDir?: string } = {},
): RecipeSyncReport {
  const loaded = loadRecipes({
    extraDir: config.extraRecipesDir,
    ...(options.bundledDir === undefined ? {} : { dir: options.bundledDir }),
  });
  const report: RecipeSyncReport = {
    added: [],
    updated: [],
    unchanged: 0,
    retired: [],
    skipped: [],
  };

  for (const error of loaded.errors) {
    report.skipped.push({
      subject: error.file,
      problems: [error.message, ...(error.issues ?? []).map(describeIssue)],
    });
  }

  const known = new Map<string, RecipeTarget>(
    db
      .select({ id: targets.id, domain: targets.domain })
      .from(targets)
      .where(eq(targets.retired, false))
      .all()
      .map((row) => [row.id, { domain: row.domain }]),
  );

  const now = nowIso(clock);
  db.transaction((tx) => {
    const seen = new Set<string>();
    for (const { recipe, origin } of loaded.recipes) {
      const problems = recipeTargetProblems(recipe, known);
      if (problems.length > 0) {
        report.skipped.push({ subject: recipe.id, problems });
        // A recipe that is broken now is not a recipe whose file is gone.
        seen.add(recipe.id);
        continue;
      }
      seen.add(recipe.id);
      const source = SOURCE_OF_ORIGIN[origin];
      const status = initialStatus(recipe, origin);
      const current = tx.select().from(recipes).where(eq(recipes.id, recipe.id)).get();
      if (!current) {
        tx.insert(recipes)
          .values({
            id: recipe.id,
            targetId: recipe.brokerId,
            purpose: recipe.purpose,
            version: recipe.version,
            definition: recipe,
            source,
            status,
            health: "unknown",
            failureCount: 0,
            notes: recipe.notes,
            createdAt: now,
          })
          .run();
        report.added.push(recipe.id);
        continue;
      }
      const stored = Recipe.parse(current.definition);
      const sameDefinition = JSON.stringify(stored) === JSON.stringify(recipe);
      const approvedByHand = status === "pending_review" && current.status === "active";
      if (
        sameDefinition &&
        current.source === source &&
        (current.status === status || approvedByHand)
      ) {
        report.unchanged += 1;
        continue;
      }
      tx.update(recipes)
        .set({
          definition: recipe,
          source,
          status,
          notes: recipe.notes,
          // A different script has no track record, so what was learned about the old one is dropped.
          ...(behaviour(stored) === behaviour(recipe)
            ? {}
            : { health: "unknown" as const, failureCount: 0 }),
        })
        .where(eq(recipes.id, recipe.id))
        .run();
      report.updated.push(recipe.id);
    }

    if (loaded.errors.length === 0) {
      const gone = tx
        .select({ id: recipes.id })
        .from(recipes)
        .where(
          and(
            inArray(recipes.source, ["bundled", "user"]),
            inArray(recipes.status, ["active", "pending_review"]),
          ),
        )
        .all()
        .map((row) => row.id)
        .filter((id) => !seen.has(id));
      if (gone.length > 0) {
        tx.update(recipes).set({ status: "retired" }).where(inArray(recipes.id, gone)).run();
        report.retired.push(...gone);
      }
    }
  });

  logger.info(
    {
      added: report.added.length,
      updated: report.updated.length,
      unchanged: report.unchanged,
      retired: report.retired.length,
      skipped: report.skipped.length,
    },
    "Recipes synced",
  );
  for (const { subject, problems } of report.skipped) {
    logger.warn({ recipe: subject, problems }, "Recipe skipped");
  }
  return report;
}
