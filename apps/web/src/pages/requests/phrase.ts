import type { RequestDetail } from "@kickrocks/shared";
import type { StatusFamily } from "../../lib/status.js";
import { REQUEST_STATUS_META } from "../../lib/status.js";
import { newestFirst } from "./detail/Timeline.js";

export interface StatusPhrase {
  text: string;
  family: StatusFamily;
}

/**
 * The words next to a request's status mark. They follow the timeline: a request still marked
 * Queued whose newest event is a failed send that will be tried again says so, instead of
 * contradicting the line below it.
 */
export function statusPhrase(request: Pick<RequestDetail, "status" | "events">): StatusPhrase {
  const meta = REQUEST_STATUS_META[request.status];
  const [latest] = newestFirst(request.events);
  if (request.status === "queued" && latest?.type === "send_failed" && latest.payload.willRetry) {
    return { text: "Will retry", family: "needs" };
  }
  return { text: meta.label, family: meta.family };
}
