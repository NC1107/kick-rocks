import type { RequestActor, RequestEvent, RequestEventType } from "@kickrocks/shared";
import { describeEvent } from "../../../lib/events.js";
import { formatDateTime, formatRelative } from "../../../lib/format.js";
import type { Tone } from "../../../lib/tone.js";

const ACTOR_LABELS: Record<RequestActor, string> = {
  system: "Kick Rocks",
  user: "you",
  worker: "the worker",
  agent: "an agent",
};

const EVENT_TONES: Record<RequestEventType, Tone> = {
  created: "blue",
  queued: "slate",
  sent: "blue",
  send_failed: "red",
  reply_received: "indigo",
  classified: "indigo",
  link_followed: "teal",
  status_changed: "neutral",
  follow_up_sent: "violet",
  channel_switched: "orange",
  awaiting_confirmation: "amber",
  task_enqueued: "slate",
  task_blocked: "amber",
  task_completed: "green",
  task_failed: "red",
  task_cancelled: "neutral",
  task_resumed: "slate",
  task_retrying: "orange",
  user_action: "blue",
  relisted: "red",
  note: "neutral",
};

/** The kind of thing that happened, so the line above the sentence adds something the sentence lacks. */
const EVENT_CATEGORIES: Record<RequestEventType, string> = {
  created: "Request",
  queued: "Request",
  sent: "Sent",
  send_failed: "Email",
  reply_received: "Reply",
  classified: "Reply",
  link_followed: "Confirmation",
  status_changed: "Status",
  follow_up_sent: "Sent",
  channel_switched: "Channel",
  awaiting_confirmation: "Confirmation",
  task_enqueued: "Task",
  task_blocked: "Task",
  task_completed: "Task",
  task_failed: "Task",
  task_cancelled: "Task",
  task_resumed: "Task",
  task_retrying: "Task",
  user_action: "You",
  relisted: "Record",
  note: "Note",
};

/**
 * Newest first, so what just happened is at the top. Events in the same moment keep the order they
 * were recorded in, reversed, so a task never reads as older than the request that started it.
 */
export function newestFirst(events: readonly RequestEvent[]): RequestEvent[] {
  return [...events].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function Timeline({ events }: { events: readonly RequestEvent[] }) {
  if (events.length === 0) {
    return <p className="text-base text-ink-muted">Nothing has happened yet.</p>;
  }
  return (
    <ol className="m-0 list-none p-0">
      {newestFirst(events).map((event, index, all) => (
        <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
          {index < all.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute top-3 bottom-0 left-[0.3125rem] w-px bg-line"
            />
          ) : null}
          <span
            data-tone={EVENT_TONES[event.type]}
            aria-hidden="true"
            className="relative mt-1.5 size-2.5 shrink-0 rounded-full bg-tone-dot ring-4 ring-surface"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink-muted">{EVENT_CATEGORIES[event.type]}</p>
            <p className="break-words text-base text-ink">{describeEvent(event)}</p>
            <p className="text-sm text-ink-faint">
              <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
                {formatRelative(event.createdAt)}
              </time>
              {` by ${ACTOR_LABELS[event.actor]}`}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
