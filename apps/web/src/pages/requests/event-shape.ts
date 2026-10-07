import type { RequestEvent } from "@kickrocks/shared";
import type { StatusShape } from "../../lib/status.js";

/** What an event means for the person, which decides its shape and whether it takes a color. */
export type EventWeight = "plain" | "needs" | "failed";

export function eventWeight(event: RequestEvent): EventWeight {
  switch (event.type) {
    case "task_failed":
    case "relisted":
      return "failed";
    case "send_failed":
      return event.payload.willRetry ? "needs" : "failed";
    case "link_followed":
      return event.payload.ok ? "plain" : "failed";
    case "task_blocked":
    case "task_retrying":
      return "needs";
    default:
      return "plain";
  }
}

/** Ordinary events are quiet rings; only trouble gets a filled shape. */
export function eventShape(event: RequestEvent): StatusShape {
  if (event.type === "task_cancelled") return "dash";
  const weight = eventWeight(event);
  if (weight === "failed") return "square";
  if (weight === "needs") return "triangle";
  return "ring";
}
