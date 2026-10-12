import { API_ROUTES, type AssignBody, type TaskSummary } from "@kickrocks/shared";
import { ApiRequestError, errorMessage, useApiMutation } from "../../api/index.js";
import { useToast } from "../../components/ui/index.js";
import { assignBodyOf, HAND_OVER_REFRESHES } from "./model.js";

/** "handoff" gives a blocked task to an agent, "assign" changes who a queued task is for. */
export type HandOverMode = "handoff" | "assign";

export type HandOverTask = Pick<TaskSummary, "id" | "assignment" | "targetName">;

function handedTitle(body: AssignBody): string {
  return typeof body.to === "object" ? `Handed to ${body.to.workerId}` : "Handed to an agent";
}

/** A failed Undo has no card left to carry the error, so it is told once, in the toast. */
function toastUndoFailure(toast: ReturnType<typeof useToast>, error: unknown) {
  if (error instanceof ApiRequestError && error.code === "task_running") {
    toast.info("Already started", "Find it in Review, Agents.");
    return;
  }
  toast.info(errorMessage(error));
}

/** Gives a task to an agent and says so with a toast that takes it back. */
export function useHandOverMutation(mode: HandOverMode, task: HandOverTask) {
  const toast = useToast();
  const assign = useApiMutation(API_ROUTES.taskAssign, { invalidates: HAND_OVER_REFRESHES });
  const handOff = useApiMutation(API_ROUTES.taskHandOff, { invalidates: HAND_OVER_REFRESHES });

  // The card that sent the hand-off is gone by the time Undo is pressed, so a mutate-level
  // callback would be dropped. The promise still settles, and the answer lands in a toast.
  const undoTo = (taskId: string, body: AssignBody) => ({
    label: "Keep for me",
    onClick: () => {
      assign.mutateAsync({ params: { id: taskId }, body }).then(
        () => toast.success("Kept for you"),
        (error: unknown) => toastUndoFailure(toast, error),
      );
    },
  });

  const send = (body: AssignBody, onDone?: () => void) => {
    if (mode === "handoff") {
      handOff.mutate(
        { params: { id: task.id }, body },
        {
          onSuccess: ({ task: handed }) => {
            toast.success(handedTitle(body), undefined, {
              action: undoTo(handed.id, { to: "person" }),
            });
            onDone?.();
          },
        },
      );
      return;
    }
    const before = assignBodyOf(task.assignment);
    assign.mutate(
      { params: { id: task.id }, body },
      {
        onSuccess: () => {
          toast.success(handedTitle(body), undefined, { action: undoTo(task.id, before) });
          onDone?.();
        },
      },
    );
  };

  const active = mode === "handoff" ? handOff : assign;
  return { send, pending: active.isPending, error: active.isError ? active.error : null };
}
