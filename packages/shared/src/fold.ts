import type { RequestEvent } from "./requests.js";

const FOLD_WINDOW_MS = 60_000;

/**
 * A status change recorded beside the event that caused it is told by that event, so it adds a row
 * without adding news. One that stands alone, such as a deadline passing, is its own story.
 */
export function tellEvents<T extends Pick<RequestEvent, "type" | "createdAt">>(
  events: readonly T[],
): T[] {
  const causes = events.filter((event) => event.type !== "status_changed");
  return events.filter(
    (event) =>
      event.type !== "status_changed" ||
      !causes.some(
        (cause) =>
          Math.abs(Date.parse(cause.createdAt) - Date.parse(event.createdAt)) <= FOLD_WINDOW_MS,
      ),
  );
}
