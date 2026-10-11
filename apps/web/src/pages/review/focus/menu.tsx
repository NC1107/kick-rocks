import { API_ROUTES, type NeedsYouItem } from "@kickrocks/shared";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { useApiMutation } from "../../../api/index.js";
import { ConfirmDialog, type MenuItem, useToast } from "../../../components/ui/index.js";
import { paths } from "../../../lib/paths.js";
import { useWide } from "../../../lib/use-wide.js";
import { AssignDialog } from "../../assign/AssignDialog.js";
import { canHandOff, REVIEW_INVALIDATES } from "../model.js";
import { useFocus } from "./context.js";
import { WORDS } from "./copy.js";
import { itemTitle } from "./model.js";

/** Whether an agent may take this item over: a stopped run or a task the person took. */
export function handOffMode(item: NeedsYouItem): "handoff" | "assign" | null {
  if (!("task" in item.source)) return null;
  const { task } = item.source.task;
  if (task.status === "queued" && task.assignment?.to.kind === "person") return "assign";
  if (task.status !== "blocked" || !canHandOff(task)) return null;
  return item.kind === "approve" || item.kind === "check_sent" ? null : "handoff";
}

export interface CancelCopy {
  title: string;
  description: string;
  confirm: string;
  keep: string;
  /** The toast once it is done. */
  toast: string;
}

const CANCEL_COPY: CancelCopy = {
  title: "Cancel this task?",
  description: "Nothing will try it again.",
  confirm: "Cancel task",
  keep: "Keep it",
  toast: "Cancelled",
};

interface MenuOptions {
  /** Entries that belong to one kind, ahead of the shared ones. */
  extra?: readonly MenuItem[];
  /** Other words for the cancel question, for a kind that cancels as its second action. */
  cancelCopy?: CancelCopy;
}

/**
 * The shared "more" menu: snooze, hand over to an agent, cancel, open the request, and the list
 * on a phone. The dialogs it opens come back with it, to be put anywhere in the card.
 */
export function useCardMenu(
  item: NeedsYouItem,
  { extra = [], cancelCopy = CANCEL_COPY }: MenuOptions = {},
): { menu: MenuItem[]; dialogs: ReactNode; openHandOff: () => void; openCancel: () => void } {
  const focus = useFocus();
  const toast = useToast();
  const navigate = useNavigate();
  const wide = useWide();
  const [cancelling, setCancelling] = useState(false);
  const [handing, setHanding] = useState(false);
  const task = "task" in item.source ? item.source.task.task : null;
  const mode = handOffMode(item);
  const cancel = useApiMutation(API_ROUTES.taskCancel, {
    invalidates: REVIEW_INVALIDATES,
    onSuccess: () => {
      setCancelling(false);
      focus.resolved();
      toast.success(`${cancelCopy.toast} · ${itemTitle(item)}`);
    },
    onError: () => setCancelling(false),
  });

  const requestId =
    task?.requestId ?? ("verification" in item.source ? item.source.verification.request.id : null);
  const accessKnown = focus.agentAccess !== "unknown";

  const items: MenuItem[] = [
    ...extra,
    ...(item.kind === "hold"
      ? []
      : [{ id: "snooze", label: "Snooze", onSelect: focus.openSnooze }]),
    ...(mode
      ? [
          {
            id: "hand-off",
            label: "Hand to an agent",
            ...(focus.agentAccess === "off" ? { description: WORDS.agentOff } : {}),
            disabled: focus.agentAccess !== "on",
            onSelect: () => setHanding(true),
          },
          ...(accessKnown && focus.agentAccess === "off"
            ? [
                {
                  id: "agent-settings",
                  label: "Agent settings",
                  onSelect: () => navigate(paths.settings("agents")),
                },
              ]
            : []),
        ]
      : []),
    ...(task
      ? [
          {
            id: "cancel",
            label: "Cancel task",
            destructive: true,
            onSelect: () => setCancelling(true),
          },
        ]
      : []),
    ...(requestId
      ? [
          {
            id: "request",
            label: "Open request",
            onSelect: () => navigate(paths.request(requestId)),
          },
        ]
      : []),
    ...(wide ? [] : [{ id: "list", label: "Show list", onSelect: focus.openList }]),
  ];

  const dialogs = (
    <>
      {task && mode ? (
        <AssignDialog open={handing} onClose={() => setHanding(false)} task={task} mode={mode} />
      ) : null}
      {task ? (
        <ConfirmDialog
          open={cancelling}
          onClose={() => setCancelling(false)}
          title={cancelCopy.title}
          description={cancelCopy.description}
          confirmLabel={cancelCopy.confirm}
          cancelLabel={cancelCopy.keep}
          destructive
          loading={cancel.isPending}
          onConfirm={() => cancel.mutate({ params: { id: task.id } })}
        />
      ) : null}
    </>
  );

  return {
    menu: items,
    dialogs,
    openHandOff: () => setHanding(true),
    openCancel: () => setCancelling(true),
  };
}

/** The "Stuck? Hand to an agent" line a card shows after two tries, when an agent may take over. */
export function stuckAllowed(item: NeedsYouItem, agentAccess: "on" | "off" | "unknown"): boolean {
  return item.tries >= 2 && agentAccess === "on" && handOffMode(item) !== null;
}
