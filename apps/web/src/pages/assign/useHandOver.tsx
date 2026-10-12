import type { ReactNode } from "react";
import { useState } from "react";
import { errorMessage, useAgents } from "../../api/index.js";
import { AssignDialog } from "./AssignDialog.js";
import { type HandOffPlan, handOffPlan } from "./model.js";
import {
  type HandOverMode,
  type HandOverTask,
  useHandOverMutation,
} from "./useHandOverMutation.js";

export interface HandOver {
  plan: HandOffPlan;
  /** Hands over at once when one agent could take it, else opens the dialog. */
  go: () => void;
  /** Opens the dialog whatever the plan, for a task that already has an agent. */
  choose: () => void;
  pending: boolean;
  /** Why the last one-tap hand-over failed, for the caller to show where the control is. */
  error: string | null;
  dialog: ReactNode;
}

const NO_TASK: HandOverTask = { id: "", assignment: null, targetName: null };

/**
 * One hand-over control for a task. With one agent that could take it, it hands over at once;
 * with several it opens the dialog; with none the caller shows a link to set one up.
 */
export function useHandOver(task: HandOverTask | null, mode: HandOverMode | null): HandOver {
  const applies = task !== null && mode !== null;
  const agents = useAgents({ taskId: task?.id, enabled: applies });
  const plan = handOffPlan(agents.data);
  const [picking, setPicking] = useState(false);
  const { send, pending, error } = useHandOverMutation(mode ?? "handoff", task ?? NO_TASK);

  return {
    plan,
    pending,
    error: error ? errorMessage(error) : null,
    go: () => (plan === "one" ? send({ to: "any" }) : setPicking(true)),
    choose: () => setPicking(true),
    dialog: applies ? (
      <AssignDialog open={picking} onClose={() => setPicking(false)} task={task} mode={mode} />
    ) : null,
  };
}
