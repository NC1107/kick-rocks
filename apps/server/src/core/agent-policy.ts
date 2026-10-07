import { recipes } from "@kickrocks/db";
import type { RecipeStatus } from "@kickrocks/shared";
import { and, eq } from "drizzle-orm";
import type { AppServices } from "../services.js";
import type { Task } from "./task-types.js";

type PolicyServices = Pick<AppServices, "db" | "settings">;

/**
 * What a recipe for the task's site says about letting a language model work it unattended.
 * - `allowed`: an approved recipe exists, or none was ever written, so a model is the fallback.
 * - `unreviewed`: a bundled recipe waits for the person's review, so a model takes the site only
 *   when the person has said it may.
 * - `rejected`: the person looked at the recipe and turned it down, so the site is theirs to handle.
 */
export type ModelStance = "allowed" | "unreviewed" | "rejected";

export function modelStance({ db }: Pick<PolicyServices, "db">, task: Task<"agent">): ModelStance {
  if (task.targetId === null) return "allowed";
  const statuses = new Set<RecipeStatus>(
    db
      .select({ status: recipes.status })
      .from(recipes)
      .where(and(eq(recipes.targetId, task.targetId), eq(recipes.purpose, task.payload.purpose)))
      .all()
      .map((row) => row.status),
  );
  if (statuses.has("active")) return "allowed";
  if (statuses.has("pending_review")) return "unreviewed";
  if (statuses.has("rejected")) return "rejected";
  return "allowed";
}

/** The queued agent tasks a model worker must leave alone, which others and the person can still take. */
export function tasksForModelToSkip(
  services: PolicyServices & Pick<AppServices, "taskQueue">,
): string[] {
  if (services.settings.get("agent.takeUnreviewed")) return [];
  return services.taskQueue
    .list({ kinds: ["agent"], status: "queued" })
    .filter((task) => modelStance(services, task as Task<"agent">) === "unreviewed")
    .map((task) => task.id);
}
