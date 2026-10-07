import { TaskKind } from "@kickrocks/shared";
import type { RequestsService } from "./requests.js";
import type { TaskHandlers } from "./task-handlers.js";
import type { Task } from "./task-types.js";

/** A short word for how a finished task ended, for the timeline. Null when there is nothing to say. */
export function taskOutcome(task: Task): string | null {
  switch (task.kind) {
    case "form":
      return task.result?.outcome ?? null;
    case "agent":
      return task.result
        ? task.result.purpose === "remove"
          ? task.result.form.outcome
          : "scanned"
        : null;
    case "scan":
      return task.result ? `${task.result.candidates.length} candidates` : null;
    case "confirm":
      return task.result ? (task.result.confirmed ? "confirmed" : "not_confirmed") : null;
    case "canary":
      return task.result ? (task.result.healthy ? "healthy" : "unhealthy") : null;
    default:
      return null;
  }
}

/**
 * Puts what happens to a task on the timeline of its request: when it was blocked, finished,
 * failed for good, cancelled, resumed, or is being retried. It runs inside the transaction of the
 * task change, so the timeline can never disagree with the queue, and a terminal failure also
 * sets the request's `lastError`, which is how a request with no live task says it needs a person.
 *
 * It does not move a request between statuses. That is what the module handlers do with a result.
 */
export function registerTaskAudit(taskHandlers: TaskHandlers, requests: RequestsService): void {
  taskHandlers.on(
    TaskKind.options,
    ["completed", "blocked", "failed", "retrying", "cancelled", "resumed"],
    ({ name, task, note }) => {
      if (task.requestId === null) return;
      const ref = { taskId: task.id, kind: task.kind };
      const actor = "system" as const;
      switch (name) {
        case "completed":
          requests.addEvent(task.requestId, {
            type: "task_completed",
            actor: actor,
            payload: { ...ref, outcome: taskOutcome(task), note: note ?? null },
          });
          return;
        case "blocked":
          requests.addEvent(task.requestId, {
            type: "task_blocked",
            actor,
            payload: {
              ...ref,
              reason: task.blockedReason ?? "unknown",
              detail: task.blockedDetail,
            },
          });
          return;
        case "failed":
          requests.update(task.requestId, { lastError: task.lastError });
          requests.addEvent(task.requestId, {
            type: "task_failed",
            actor,
            payload: {
              ...ref,
              error: task.lastError ?? "The task failed",
              failureKind: task.failureKind,
            },
          });
          return;
        case "retrying":
          requests.addEvent(task.requestId, {
            type: "task_retrying",
            actor,
            payload: { ...ref, error: task.lastError ?? "The task failed", attempt: task.attempts },
          });
          return;
        case "cancelled":
          requests.addEvent(task.requestId, { type: "task_cancelled", actor, payload: ref });
          return;
        case "resumed":
          requests.addEvent(task.requestId, { type: "task_resumed", actor, payload: ref });
          return;
      }
    },
  );
}
