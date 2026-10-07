import type { RequestEvent, TaskSummary } from "@kickrocks/shared";
import { Button, MonoEmails, Tooltip } from "../../../components/ui/index.js";
import { cn } from "../../../lib/cn.js";
import { describeEvent } from "../../../lib/events.js";
import { tellEvents } from "../../../lib/fold.js";
import { formatDateTime } from "../../../lib/format.js";
import { EventRow } from "../EventRow.js";
import { eventShape, eventWeight } from "../event-shape.js";
import { gutterTime } from "../format.js";

const GROUP_WINDOW_MS = 60_000;

/**
 * Newest first, so what just happened is at the top. Events in the same moment keep the order they
 * were recorded in, reversed, so a task never reads as older than the request that started it.
 */
export function newestFirst(events: readonly RequestEvent[]): RequestEvent[] {
  return [...events].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface EventGroup {
  /** The time of the newest event, which labels the group in the gutter. */
  at: string;
  events: RequestEvent[];
}

/**
 * Events within a minute of the newest one in a group share a single time. A status change that
 * happened beside the event that caused it is folded into that event's sentence and left out.
 */
export function groupEvents(events: readonly RequestEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  for (const event of newestFirst(tellEvents(events))) {
    const group = groups.at(-1);
    if (group && Date.parse(group.at) - Date.parse(event.createdAt) <= GROUP_WINDOW_MS) {
      group.events.push(event);
    } else {
      groups.push({ at: event.createdAt, events: [event] });
    }
  }
  return groups;
}

/**
 * The failed task a person can still retry: the newest failure, with nothing queued after it.
 * Older failures stay as history, so a retried task does not offer the same button twice.
 */
export function retryableFailure(
  events: readonly RequestEvent[],
  tasks: readonly TaskSummary[],
): RequestEvent | undefined {
  const [newest] = newestFirst(events).filter((event) => event.type === "task_failed");
  if (newest?.type !== "task_failed") return undefined;
  const requeued = events.some(
    (event) =>
      (event.type === "task_enqueued" || event.type === "task_resumed") &&
      event.createdAt >= newest.createdAt &&
      event.id !== newest.id,
  );
  const stillFailed = tasks.some(
    (task) => task.id === newest.payload.taskId && task.status === "failed",
  );
  return requeued || !stillFailed ? undefined : newest;
}

const WEIGHT_TEXT = {
  plain: "text-ink",
  needs: "text-attention-text",
  failed: "text-danger-text",
} as const;

export interface TimelineProps {
  events: readonly RequestEvent[];
  tasks: readonly TaskSummary[];
  /** The request's last error, shown only when no failed event carries it already. */
  lastError: string | null;
  /** Whether the request is still open, since a closed one has nothing to retry. */
  open: boolean;
  onRetry: (taskId: string) => void;
  retrying: boolean;
  retryError: string | null;
}

export function Timeline({
  events,
  tasks,
  lastError,
  open,
  onRetry,
  retrying,
  retryError,
}: TimelineProps) {
  if (events.length === 0) {
    return <p className="py-1 text-ui text-ink-2">Nothing has happened yet.</p>;
  }
  const failureShown = events.some((event) =>
    ["send_failed", "task_failed", "task_retrying"].includes(event.type),
  );
  const failure = open ? retryableFailure(events, tasks) : undefined;
  const retry =
    failure?.type === "task_failed"
      ? { eventId: failure.id, taskId: failure.payload.taskId }
      : undefined;
  return (
    <ol className="m-0 list-none p-0">
      {lastError && !failureShown ? (
        <EventRow shape="square">
          <p className="break-words text-ui text-danger-text">{lastError}</p>
        </EventRow>
      ) : null}
      {groupEvents(events).flatMap((group) =>
        group.events.map((event, index) => {
          const weight = eventWeight(event);
          const sentence = describeEvent(event);
          return (
            <EventRow
              key={event.id}
              shape={eventShape(event)}
              time={
                index === 0 ? (
                  <Tooltip content={formatDateTime(group.at)}>
                    <time dateTime={group.at}>{gutterTime(group.at)}</time>
                  </Tooltip>
                ) : undefined
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <p className={cn("min-w-0 break-words text-ui", WEIGHT_TEXT[weight])}>
                  <MonoEmails text={sentence} />
                  {event.actor === "user" && !sentence.startsWith("You") ? (
                    <span className="ml-2 text-caption text-ink-3">you</span>
                  ) : null}
                </p>
                {event.id === retry?.eventId ? (
                  <Button size="sm" loading={retrying} onClick={() => onRetry(retry.taskId)}>
                    Retry
                  </Button>
                ) : null}
              </div>
              {event.id === retry?.eventId && retryError ? (
                <p className="mt-0.5 text-meta text-danger-text">{retryError}</p>
              ) : null}
            </EventRow>
          );
        }),
      )}
    </ol>
  );
}
