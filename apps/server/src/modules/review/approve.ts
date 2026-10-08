import type { ApproveSendsBody } from "@kickrocks/shared";
import { conflict } from "../../core/errors.js";
import type { Task } from "../../core/task-types.js";
import type { AppServices } from "../../services.js";

/**
 * A person says the model may send the requests its last run held and let lapse. Each one is
 * approved for the next run, which spends it at most once, and the task goes back in the queue.
 * A run that sent something nobody approved cannot ask for this, because the next run would only
 * repeat it, and a task with no held request has nothing to approve.
 */
export function approveSubmit(services: AppServices, taskId: string, body: ApproveSendsBody): Task {
  return services.db.transaction(() => {
    const task = services.taskQueue.getOrThrow(taskId);
    if (
      task.kind !== "agent" ||
      task.status !== "blocked" ||
      task.blockedReason !== "approval_needed"
    ) {
      throw conflict("invalid_task_state", `Task ${taskId} is not waiting for a submit approval`);
    }
    if (services.taskSends.hasUnapprovedRelease(taskId)) {
      throw conflict(
        "unapproved_release",
        `Task ${taskId} sent something nobody approved, so it cannot be approved again`,
      );
    }
    services.taskSends.approveForNextRun(taskId, body.declineSendIds);
    return services.taskQueue.resume(taskId, "user");
  });
}
