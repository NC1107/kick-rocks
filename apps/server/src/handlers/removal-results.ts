import { type DbHandle, recipes, type TargetRow } from "@kickrocks/db";
import { FORM_OUTCOMES, type FormResult, type RequestActor } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { isTrustedConfirmationSender } from "../core/targets.js";
import type { Task } from "../core/task-types.js";
import { responseWindow } from "../runners/deadlines.js";
import type { AppServices } from "../services.js";
import { handToAgentAfterRecipeFailure, recordRecipeRun } from "./recipe-runs.js";

interface ConfirmationExpectation {
  fromDomains: string[];
  linkTextPattern: string | null;
}

/**
 * Who the confirmation email will come from and what its link says, taken from the recipe's
 * `email_confirmation` step and from what the page itself told the run.
 */
function expectedConfirmation(
  tx: DbHandle,
  target: TargetRow,
  recipeId: string | null,
  result: FormResult,
): ConfirmationExpectation {
  const definition = recipeId
    ? tx
        .select({ definition: recipes.definition })
        .from(recipes)
        .where(eq(recipes.id, recipeId))
        .get()?.definition
    : undefined;
  const step = definition?.steps.find((candidate) => candidate.kind === "email_confirmation");
  const reported = result.confirmationFrom?.toLowerCase();
  const domains = [step?.fromDomain?.toLowerCase(), reported]
    .filter((domain): domain is string => Boolean(domain))
    .filter((domain) => isTrustedConfirmationSender(target, domain));
  return {
    fromDomains: [...new Set(domains)],
    linkTextPattern: step?.linkTextPattern ?? null,
  };
}

/**
 * Applies how a removal form ended to its request, while the request is still waiting on it. A
 * request the person cancelled or settled by hand since is left alone. A person who marks the task
 * done without saying how it ended did the removal themselves, so it counts as submitted.
 */
function applyRemoval(
  services: AppServices,
  tx: DbHandle,
  task: Task<"form"> | Task<"agent">,
  result: FormResult | null,
  actor: RequestActor,
): void {
  if (task.requestId === null) return;
  const request = services.requests.get(task.requestId);
  if (request?.status !== "queued") return;

  const outcome = result?.outcome ?? "submitted";
  const to = FORM_OUTCOMES[outcome];
  if (to !== "awaiting_reply") {
    services.requests.transition(request.id, to, { actor });
    return;
  }

  const now = services.clock.now();
  const window = responseWindow(services, request, now);
  const waiting = outcome === "awaiting_email_confirmation";
  services.requests.transition(request.id, to, {
    actor,
    event: {
      type: "sent",
      payload: { channel: "form", kind: "initial", messageId: null, mailboxId: request.mailboxId },
    },
    patch: {
      sentAt: now.toISOString(),
      followUps: 0,
      dueAt: window.dueAt,
      followUpAt: window.followUpAt,
      lastError: null,
      awaitingConfirmationSince: waiting ? now.toISOString() : null,
    },
  });
  if (waiting && result) {
    const recipeId = task.kind === "form" ? task.payload.recipeId : null;
    services.requests.addEvent(request.id, {
      type: "awaiting_confirmation",
      actor,
      payload: expectedConfirmation(
        tx,
        services.targets.getOrThrow(request.targetId),
        recipeId,
        result,
      ),
    });
  }
}

/** Form and agent removal results move their request along; a broken recipe becomes an agent task. */
export function registerRemovalHandlers(services: AppServices): void {
  const { taskHandlers } = services;

  taskHandlers.on("form", "completed", ({ task, actor }, tx) => {
    recordRecipeRun(services, tx, task.payload.recipeId, true);
    applyRemoval(services, tx, task, task.result, actor);
  });

  taskHandlers.on("agent", "completed", ({ task, actor }, tx) => {
    if (task.payload.purpose !== "remove") return;
    const result = task.result?.purpose === "remove" ? task.result.form : null;
    applyRemoval(services, tx, task, result, actor);
  });

  taskHandlers.on("form", "failed", ({ task }, tx) => {
    if (task.failureKind !== "recipe") return;
    recordRecipeRun(services, tx, task.payload.recipeId, false);
    const request = services.requests.get(task.payload.requestId);
    if (request?.status !== "queued") return;
    if (handToAgentAfterRecipeFailure(services, task) !== null) {
      // The agent task now holds the work, so the request no longer needs a person.
      services.requests.update(request.id, { lastError: null });
    }
  });
}
