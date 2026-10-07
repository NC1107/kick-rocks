import { type RecipeRow, recipes, targets } from "@kickrocks/db";
import {
  Recipe,
  type RecipePurpose,
  type RecipeRecord,
  type RecipeSource,
  type RecipeStatus,
  recipeId,
} from "@kickrocks/shared";
import { and, desc, eq, max } from "drizzle-orm";
import { nowIso } from "../../core/clock.js";
import { AppError, conflict, notFound } from "../../core/errors.js";
import { recipeTargetProblems } from "../../core/recipe-catalog.js";
import type { AppServices } from "../../services.js";
import { behaviour } from "./behaviour.js";

/** Open proposals one broker and purpose may hold, so an agent cannot bury the review queue. */
export const MAX_PENDING_PER_TARGET_PURPOSE = 5;

export interface RecipeListFilter {
  status?: RecipeStatus | undefined;
  source?: RecipeSource | undefined;
  targetId?: string | undefined;
  purpose?: RecipePurpose | undefined;
}

export interface ProposalInput {
  recipe: Recipe;
  notes?: string | undefined;
}

export interface RecipeStore {
  list(filter?: RecipeListFilter): RecipeRecord[];
  get(id: string): RecipeRecord;
  /** Stores a proposal for review, numbered by the server. It never runs until a person approves it. */
  propose(input: ProposalInput): RecipeRecord;
  approve(id: string): RecipeRecord;
  reject(id: string): RecipeRecord;
}

type StoreServices = Pick<AppServices, "db" | "clock">;

function toRecord(row: RecipeRow, targetName: string): RecipeRecord {
  return {
    id: row.id,
    targetId: row.targetId,
    targetName,
    purpose: row.purpose,
    version: row.version,
    source: row.source,
    status: row.status,
    health: row.health,
    failureCount: row.failureCount,
    lastCheckedAt: row.lastCheckedAt,
    notes: row.notes,
    createdAt: row.createdAt,
    definition: Recipe.parse(row.definition),
  };
}

/** A shipped recipe whose author did not see the whole flow works is a proposal in all but name. */
function isReviewable(record: RecipeRecord): boolean {
  if (record.source === "proposed") return true;
  return record.source === "bundled" && record.definition.liveStatus !== "verified";
}

export function createRecipeStore({ db, clock }: StoreServices): RecipeStore {
  const selectWithTarget = () =>
    db
      .select({ recipe: recipes, targetName: targets.name })
      .from(recipes)
      .innerJoin(targets, eq(recipes.targetId, targets.id));

  function load(id: string): RecipeRecord {
    const found = selectWithTarget().where(eq(recipes.id, id)).get();
    if (!found) throw notFound(`Recipe ${id} not found`, "recipe_not_found");
    return toRecord(found.recipe, found.targetName);
  }

  /** Approving and rejecting are decisions about a proposal; a verified shipped or a local recipe is not one. */
  function reviewable(id: string): RecipeRecord {
    const record = load(id);
    if (!isReviewable(record)) {
      throw conflict(
        "recipe_not_proposed",
        `Recipe ${id} came from ${record.source}, not from a proposal, so it is not reviewed here`,
      );
    }
    if (record.status === "retired") {
      throw conflict("recipe_retired", `Recipe ${id} is retired`);
    }
    return record;
  }

  function setStatus(id: string, status: RecipeStatus): RecipeRecord {
    const current = reviewable(id);
    if (current.status === status) return current;
    db.update(recipes).set({ status }).where(eq(recipes.id, id)).run();
    return load(id);
  }

  return {
    list({ status, source, targetId, purpose } = {}) {
      const conditions = [
        status ? eq(recipes.status, status) : undefined,
        source ? eq(recipes.source, source) : undefined,
        targetId ? eq(recipes.targetId, targetId) : undefined,
        purpose ? eq(recipes.purpose, purpose) : undefined,
      ].filter((condition) => condition !== undefined);
      return selectWithTarget()
        .where(and(...conditions))
        .orderBy(desc(recipes.createdAt), desc(recipes.version), recipes.id)
        .all()
        .map(({ recipe, targetName }) => toRecord(recipe, targetName));
    },

    get: load,

    approve: (id) => setStatus(id, "active"),

    reject: (id) => setStatus(id, "rejected"),

    propose({ recipe, notes }) {
      return db.transaction((tx) => {
        const target = tx.select().from(targets).where(eq(targets.id, recipe.brokerId)).get();
        if (!target) {
          throw notFound(`Target ${recipe.brokerId} not found`, "target_not_found");
        }
        if (target.retired) {
          throw conflict("target_retired", `Target ${target.id} is no longer in the dataset`);
        }

        const known = new Map([[target.id, { domain: target.domain }]]);
        for (const other of recipe.alsoFor) {
          const row = tx.select().from(targets).where(eq(targets.id, other)).get();
          if (row && !row.retired) known.set(row.id, { domain: row.domain });
        }
        const problems = recipeTargetProblems(recipe, known);
        if (problems.length > 0) {
          throw new AppError(
            400,
            "invalid_recipe",
            "The recipe does not fit the broker it names",
            problems.map((message) => ({ path: ["recipe"], message })),
          );
        }

        const siblings = tx
          .select()
          .from(recipes)
          .where(and(eq(recipes.targetId, target.id), eq(recipes.purpose, recipe.purpose)))
          .all();
        const wanted = behaviour(recipe);
        for (const row of siblings) {
          if (row.status === "retired" || behaviour(Recipe.parse(row.definition)) !== wanted) {
            continue;
          }
          if (row.status === "pending_review") return toRecord(row, target.name);
          throw conflict(
            "recipe_unchanged",
            `Recipe ${row.id} already does exactly this and is ${row.status}`,
          );
        }
        const pending = siblings.filter((row) => row.status === "pending_review").length;
        if (pending >= MAX_PENDING_PER_TARGET_PURPOSE) {
          throw conflict(
            "too_many_proposals",
            `${pending} ${recipe.purpose} proposals for ${target.id} are already waiting for review`,
          );
        }

        const newest = tx
          .select({ version: max(recipes.version) })
          .from(recipes)
          .where(and(eq(recipes.targetId, target.id), eq(recipes.purpose, recipe.purpose)))
          .get();
        const version = (newest?.version ?? 0) + 1;
        const definition = Recipe.parse({
          ...recipe,
          id: recipeId(target.id, recipe.purpose, version),
          version,
          liveStatus: "unverified",
          verifiedAt: null,
        });
        const row = tx
          .insert(recipes)
          .values({
            id: definition.id,
            targetId: target.id,
            purpose: definition.purpose,
            version,
            definition,
            source: "proposed",
            status: "pending_review",
            health: "unknown",
            failureCount: 0,
            notes: notes ?? definition.notes,
            createdAt: nowIso(clock),
          })
          .returning()
          .get();
        return toRecord(row, target.name);
      });
    },
  };
}
