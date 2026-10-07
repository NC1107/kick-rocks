import { isActiveStatus } from "@kickrocks/shared";
import { conflict } from "../../core/errors.js";
import type { EnqueueResult } from "../../core/task-queue.js";
import type { Task } from "../../core/task-types.js";
import type { AppServices } from "../../services.js";

/**
 * Puts the work of a task that failed for good back in the queue, which nothing does by itself:
 * the request's task again, or the scan, whichever the task was for. Returns null when there is
 * nothing left to retry because the request has been settled since.
 */
export function retryFailedTask(services: AppServices, taskId: string): Task | null {
  return services.db.transaction(() => {
    const task = services.taskQueue.getOrThrow(taskId);
    if (task.status !== "failed") {
      throw conflict(
        "invalid_task_state",
        `Task ${taskId} is ${task.status}, so it cannot be retried`,
      );
    }
    const queued = enqueueAgain(services, task);
    if (queued === null) return null;

    if (task.requestId !== null) {
      services.requests.update(task.requestId, { lastError: null });
      services.requests.addEvent(task.requestId, {
        type: "user_action",
        actor: "user",
        payload: { action: "retry_task", note: null },
      });
    }
    return queued.task;
  });
}

function enqueueAgain(services: AppServices, task: Task): EnqueueResult | null {
  const { dispatch, requests } = services;

  if (task.kind === "scan" || (task.kind === "agent" && task.payload.purpose === "scan")) {
    if (task.profileId === null || task.targetId === null) return null;
    return dispatch.enqueueScan(task.profileId, task.targetId, task.payload.variant);
  }
  if (task.kind === "inbox_poll") return dispatch.enqueueInboxPoll(task.payload.mailboxId);
  if (task.kind === "canary") return dispatch.enqueueCanary(task.payload.recipeId);

  const request = task.requestId ? requests.get(task.requestId) : null;
  if (!request || !isActiveStatus(request.status)) return null;

  if (task.kind === "confirm") return dispatch.enqueueConfirm(request.id, task.payload.url);
  if (request.status !== "queued") {
    throw conflict(
      "invalid_request_state",
      `The request is ${request.status}, so its task cannot be retried`,
    );
  }
  if (task.kind === "email_send") {
    return dispatch.dispatchRequest(request.id, {
      kind: task.payload.kind,
      fields: task.payload.fields,
      inReplyTo: task.payload.inReplyTo,
    });
  }
  return dispatch.dispatchRequest(request.id);
}
