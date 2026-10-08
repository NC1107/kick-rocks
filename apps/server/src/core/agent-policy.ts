import { recipes } from "@kickrocks/db";
import {
  type ClaimerKind,
  type GateVerdict,
  gateVerdict,
  type ModelIdentity,
  type RecipeStatus,
  type SubmitApproval,
} from "@kickrocks/shared";
import { and, eq } from "drizzle-orm";
import type { AppServices } from "../services.js";
import type { Task } from "./task-types.js";

type PolicyServices = Pick<AppServices, "db" | "settings" | "taskQueue">;

/**
 * What a recipe for the task's site says about letting a language model work it unattended.
 * - `allowed`: an approved recipe exists, or none was ever written, so a model is the fallback.
 * - `unreviewed`: a bundled recipe waits for the person's review, so a model takes the site only
 *   when the person has said it may.
 * - `rejected`: the person looked at the recipe and turned it down, so the site is theirs to handle.
 */
type ModelStance = "allowed" | "unreviewed" | "rejected";

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

/**
 * The queued agent tasks a model worker must leave alone, which others and the person can still
 * take. A task a person handed over from a site whose recipe they rejected is one: the built-in
 * worker would only block it again, undoing the hand-off, so it waits for a connected client.
 */
export function tasksForModelToSkip(services: PolicyServices): string[] {
  const takeUnreviewed = services.settings.get("agent.takeUnreviewed");
  return services.taskQueue
    .list({ kinds: ["agent"], status: "queued" })
    .filter((task) => {
      const stance = modelStance(services, task as Task<"agent">);
      if (stance === "unreviewed") return !takeUnreviewed;
      return stance === "rejected" && (task as Task<"agent">).payload.reason === "blocked";
    })
    .map((task) => task.id);
}

/** Whether the model a claim named may take agent tasks unattended, by what this install has on record. */
export function modelGate(
  { settings }: Pick<PolicyServices, "settings">,
  model: ModelIdentity | undefined,
): GateVerdict {
  return gateVerdict(settings.get("agent.gate").records, model ?? null);
}

/**
 * What a model-backed claim may do about submitting a removal, and the state to keep on the task.
 * A scan sends nothing. A model that is not cleared needs a person's approval for the submit, and
 * an approval is spent by the one claim that takes it, so the next attempt asks again.
 */
export function settleSubmitApproval(
  services: Pick<PolicyServices, "settings" | "taskQueue">,
  task: Task<"agent">,
  claimerKind: ClaimerKind,
  model: ModelIdentity | undefined,
): SubmitApproval {
  const { taskQueue } = services;
  // A claim that does not say it drives a model is unproven whatever model it names, since the
  // worker API cannot tell which model is really behind it.
  const named = claimerKind === "model" ? model : undefined;
  if (task.payload.purpose !== "remove" || modelGate(services, named).unattended) {
    taskQueue.setSubmitApproval(task.id, null);
    return "not_needed";
  }
  if (task.submitApproval === "granted") {
    taskQueue.setSubmitApproval(task.id, "used");
    return "granted";
  }
  taskQueue.setSubmitApproval(task.id, "required");
  return "required";
}
