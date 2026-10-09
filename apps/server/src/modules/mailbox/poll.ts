import type { MailboxRow } from "@kickrocks/db";
import type { MailboxPoll, MailboxPollOutcome, TaskSummary } from "@kickrocks/shared";
import { AppError, notFound } from "../../core/errors.js";
import type { Task } from "../../core/task-types.js";
import type { AppServices } from "../../services.js";

type PollTask = Task<"inbox_poll">;
type PollServices = Pick<AppServices, "clock" | "dispatch" | "taskQueue">;

/** A mail provider throttles clients that ask too often, so a person's taps are spaced this far apart. */
export const MANUAL_POLL_GAP_MS = 30_000;

const LIVE_POLL_STATUSES = ["queued", "leased"] as const;

const isPollOf =
  (mailboxId: string) =>
  (task: Task | null): task is PollTask =>
    task?.kind === "inbox_poll" && task.payload.mailboxId === mailboxId;

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function outcomeOf(task: PollTask): MailboxPollOutcome | null {
  if (task.status === "done") {
    const result = task.result ?? {};
    return {
      state: "done",
      newMessages: count(result.stored),
      matched: count(result.matched),
      needsReview: count(result.needsReview),
      matchedRequestIds: Array.isArray(result.matchedRequestIds)
        ? result.matchedRequestIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  }
  if (task.status === "failed" || task.status === "cancelled") {
    return { state: "failed", error: task.lastError ?? "The check did not finish." };
  }
  return null;
}

export function describePoll(services: PollServices, task: PollTask): MailboxPoll {
  const [summary]: TaskSummary[] = services.taskQueue.summarize([task]);
  if (!summary) throw new AppError(500, "internal_error", "The poll was queued but not found");
  return { task: summary, outcome: outcomeOf(task) };
}

function secondsText(seconds: number): string {
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

/**
 * Starts a check the person asked for. A check already waiting or running is returned as it is, so
 * repeated taps share it; otherwise the mailbox must not have been read in the last half minute.
 */
export function startManualPoll(services: PollServices, mailbox: MailboxRow): MailboxPoll {
  const running = services.taskQueue
    .list({ kinds: ["inbox_poll"], profileId: mailbox.profileId, status: LIVE_POLL_STATUSES })
    .find(isPollOf(mailbox.id));
  if (running) return describePoll(services, running);

  if (mailbox.lastPolledAt) {
    const since = services.clock.now().getTime() - Date.parse(mailbox.lastPolledAt);
    if (since >= 0 && since < MANUAL_POLL_GAP_MS) {
      // The elapsed time rounds down and the wait rounds up, so the two always add to the gap.
      const ago = Math.floor(since / 1000);
      const wait = MANUAL_POLL_GAP_MS / 1000 - ago;
      throw new AppError(
        429,
        "poll_too_soon",
        `Checked ${secondsText(ago)} ago. Try again in ${secondsText(wait)}.`,
        undefined,
        wait,
      );
    }
  }
  const { task } = services.dispatch.enqueueInboxPoll(mailbox.id);
  if (!isPollOf(mailbox.id)(task))
    throw new AppError(500, "internal_error", "The poll was not queued");
  return describePoll(services, task);
}

export function findPoll(services: PollServices, mailbox: MailboxRow, taskId: string): MailboxPoll {
  const task = services.taskQueue.get(taskId);
  if (!isPollOf(mailbox.id)(task)) {
    throw notFound("That check was not found", "poll_not_found");
  }
  return describePoll(services, task);
}
