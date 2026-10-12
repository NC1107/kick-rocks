import { API_ROUTES, isPersonOnlyBlock, type NeedsYouItem } from "@kickrocks/shared";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { useApiMutation } from "../../../api/index.js";
import {
  ConfirmDialog,
  InlineError,
  type MenuItem,
  useToast,
} from "../../../components/ui/index.js";
import { paths } from "../../../lib/paths.js";
import { useWide } from "../../../lib/use-wide.js";
import { useHandOver } from "../../assign/useHandOver.js";
import { canHandOff, REVIEW_INVALIDATES } from "../model.js";
import { useFocus } from "./context.js";
import { itemTitle } from "./model.js";

/**
 * Whether an agent may take this item over: a stopped run or a task the person took. A block an
 * agent cannot pass either, such as a bot check, is the person's alone.
 */
export function handOffMode(item: NeedsYouItem): "handoff" | "assign" | null {
  if (!("task" in item.source)) return null;
  const { task } = item.source.task;
  if (task.status === "queued" && task.assignment?.to.kind === "person") return "assign";
  if (task.status !== "blocked" || !canHandOff(task) || isPersonOnlyBlock(task.blockedReason)) {
    return null;
  }
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
  /** The card shows its own hand-over line when stuck, so the menu does not repeat it. */
  stuckLine?: boolean;
}

export interface CardMenu {
  menu: MenuItem[];
  dialogs: ReactNode;
  /** The card should show its hand-over line: tried twice, and an agent could take over. */
  stuck: boolean;
  handOver: () => void;
  /** Why a one-tap hand-over failed, to show inside the card. */
  notice: ReactNode;
  openCancel: () => void;
}

/**
 * The shared "more" menu: snooze, hand over to an agent, cancel, open the request, and the list
 * on a phone. The dialogs it opens come back with it, to be put anywhere in the card.
 */
export function useCardMenu(
  item: NeedsYouItem,
  { extra = [], cancelCopy = CANCEL_COPY, stuckLine = false }: MenuOptions = {},
): CardMenu {
  const focus = useFocus();
  const toast = useToast();
  const navigate = useNavigate();
  const wide = useWide();
  const [cancelling, setCancelling] = useState(false);
  const task = "task" in item.source ? item.source.task.task : null;
  const mode = handOffMode(item);
  const handOver = useHandOver(task, mode);
  const stuck =
    stuckLine && item.tries >= 2 && (handOver.plan === "one" || handOver.plan === "pick");
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

  const items: MenuItem[] = [
    ...extra,
    ...(item.kind === "hold"
      ? []
      : [{ id: "snooze", label: "Snooze", onSelect: focus.openSnooze }]),
    ...(mode && !stuck
      ? [
          handOver.plan === "setup"
            ? {
                id: "agent-settings",
                label: "Set up an agent",
                onSelect: () => navigate(paths.settings("agents")),
              }
            : {
                id: "hand-off",
                label: "Hand to an agent",
                disabled: handOver.plan === "loading" || handOver.pending,
                onSelect: handOver.go,
              },
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
      {handOver.dialog}
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
    stuck,
    handOver: handOver.go,
    notice: handOver.error ? <InlineError>{handOver.error}</InlineError> : null,
    openCancel: () => setCancelling(true),
  };
}
