import type { RequestActor, RequestEvent, RequestEventType } from "@kickrocks/shared";
import { describeEvent } from "../../../lib/events.js";
import { formatDateTime, formatRelative } from "../../../lib/format.js";
import { REQUEST_EVENT_LABELS } from "../../../lib/labels.js";
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

/** Newest first, so what just happened is at the top. */
export function newestFirst(events: readonly RequestEvent[]): RequestEvent[] {
  return [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
            <p className="text-sm font-medium text-ink-muted">{REQUEST_EVENT_LABELS[event.type]}</p>
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
