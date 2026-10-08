import { conflict } from "../../core/errors.js";
import type { Task } from "../../core/task-types.js";
import type { AppServices } from "../../services.js";

/**
 * A person says the model may send the form it stopped at. The task goes back in the queue with
 * the approval attached, and the next model claim that takes it spends the approval.
 */
export function approveSubmit(services: AppServices, taskId: string): Task {
  return services.db.transaction(() => {
    const task = services.taskQueue.getOrThrow(taskId);
    if (
      task.kind !== "agent" ||
      task.status !== "blocked" ||
      task.blockedReason !== "approval_needed"
    ) {
      throw conflict("invalid_task_state", `Task ${taskId} is not waiting for a submit approval`);
    }
    services.taskQueue.setSubmitApproval(taskId, "granted");
    return services.taskQueue.resume(taskId, "user");
  });
}
