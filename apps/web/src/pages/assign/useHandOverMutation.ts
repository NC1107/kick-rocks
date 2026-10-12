import { API_ROUTES, type AssignBody, type TaskSummary } from "@kickrocks/shared";
import { useApiMutation } from "../../api/index.js";
import { useToast } from "../../components/ui/index.js";
import { assignBodyOf, HAND_OVER_REFRESHES } from "./model.js";

/** "handoff" gives a blocked task to an agent, "assign" changes who a queued task is for. */
export type HandOverMode = "handoff" | "assign";

export type HandOverTask = Pick<TaskSummary, "id" | "assignment" | "targetName">;

function handedTitle(body: AssignBody): string {
  return typeof body.to === "object" ? `Handed to ${body.to.workerId}` : "Handed to an agent";
}

/** Gives a task to an agent and says so with a toast that takes it back. */
export function useHandOverMutation(mode: HandOverMode, task: HandOverTask) {
  const toast = useToast();
  const assign = useApiMutation(API_ROUTES.taskAssign, { invalidates: HAND_OVER_REFRESHES });
  const handOff = useApiMutation(API_ROUTES.taskHandOff, { invalidates: HAND_OVER_REFRESHES });

  const undoTo = (taskId: string, body: AssignBody) => ({
    label: "Undo",
    onClick: () =>
      assign.mutate(
        { params: { id: taskId }, body },
        { onSuccess: () => toast.success("Kept for you") },
      ),
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
