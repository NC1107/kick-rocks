import { recipes } from "@kickrocks/db";
import {
  type ClaimerKind,
  type GateVerdict,
  gateVerdict,
  type ModelIdentity,
  type RecipeStatus,
  type SubmitApproval,
  type SubmitGate,
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

/** What an agent claim is told about its outgoing requests, and the state kept on the task. */
interface SettledGate {
  approval: SubmitApproval | undefined;
  gate: SubmitGate | undefined;
}

/**
 * What a claim may do about sending a removal, and the state to keep on the task. A scan sends
 * nothing. A model that is not cleared has every send held for a person, with whatever the person
 * approved for this run. A cleared model sends alone, and each send is logged first. An MCP client
 * drives a browser of its own, which this gate cannot see, so it is held to nothing and anything
 * a person approved for a model run lapses with the hand-off.
 */
export function settleSubmitGate(
  services: Pick<PolicyServices, "settings" | "taskQueue"> & Pick<AppServices, "taskSends">,
  task: Task<"agent">,
  claimerKind: ClaimerKind,
  model: ModelIdentity | undefined,
): SettledGate {
  const { taskQueue, taskSends } = services;
  const clear = (approval: SubmitApproval | undefined): SettledGate => {
    taskQueue.setSubmitApproval(task.id, null);
    taskSends.endRun(task.id);
    return { approval, gate: undefined };
  };
  if (claimerKind === "mcp") return clear(undefined);
  if (task.payload.purpose !== "remove") return clear("not_needed");
  // A claim that does not say it drives a model is unproven whatever model it names, since the
  // worker API cannot tell which model is really behind it.
  const named = claimerKind === "model" ? model : undefined;
  if (modelGate(services, named).unattended) {
    const settled = clear("not_needed");
    taskSends.startRun(task.id, task.attempts);
    return {
      ...settled,
      gate: { mode: "record", holdMs: 0, approved: [], declined: [] },
    };
  }
  taskQueue.setSubmitApproval(task.id, "required");
  const holdMs = services.settings.get("agent.approvalHoldMinutes") * 60_000;
  const { approved, declined } = taskSends.gateFor(task.id);
  taskSends.startRun(task.id, task.attempts);
  return { approval: "required", gate: { mode: "hold", holdMs, approved, declined } };
}
