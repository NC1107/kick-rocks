import { type DbHandle, recipes } from "@kickrocks/db";
import { eq } from "drizzle-orm";
import { AppError } from "../core/errors.js";
import type { EnqueueResult } from "../core/task-queue.js";
import type { Task } from "../core/task-types.js";
import type { AppServices } from "../services.js";

/**
 * Counts a real run against a recipe's health. A recipe that was removed since the task was queued
 * is not an error: the world moved on, and there is nothing left to count against.
 */
export function recordRecipeRun(
  services: AppServices,
  tx: DbHandle,
  recipeId: string | null,
  ok: boolean,
): void {
  if (recipeId === null) return;
  const known = tx.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, recipeId)).get();
  if (known) services.recipeHealth.recordRun(recipeId, { ok });
}

/**
 * Hands the work of a scan or form task whose recipe broke to an agent. Returns the enqueue result
 * when an agent task now holds the work, so the caller can tell a task it created from one that
 * was already live, and null when nothing took the work over.
 */
export function handToAgentAfterRecipeFailure(
  services: AppServices,
  task: Task<"scan" | "form">,
): EnqueueResult | null {
  try {
    return services.dispatch.fallbackToAgent(task, {
      reason: "recipe_failed",
      error: task.lastError,
    });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    services.logger.warn(
      { taskId: task.id, code: error.code },
      "could not hand a failed recipe run to an agent",
    );
    return null;
  }
}
