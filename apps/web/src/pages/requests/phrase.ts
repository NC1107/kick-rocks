import type { RequestDetail, RequestStatus } from "@kickrocks/shared";
import { formatShortDate } from "../../lib/format.js";
import type { StatusFamily } from "../../lib/status.js";
import { REQUEST_STATUS_META } from "../../lib/status.js";
import { newestFirst } from "./detail/Timeline.js";

export interface StatusPhrase {
  text: string;
  family: StatusFamily;
}

/** What a request needs to say how it ended: its status, and either its events or the date a scan verified it. */
export interface PhraseSource {
  status: RequestStatus;
  events?: RequestDetail["events"];
  verifiedGoneAt?: string | null;
  retrying?: boolean;
}

/** What the person does about a request that is waiting on them, one short imperative per status. */
const NEXT_STEPS: Partial<Record<RequestStatus, string>> = {
  no_response: "Send a follow-up",
  bounced: "Check the address",
  needs_verification: "Open and answer them",
  rejected: "Read their reply",
  follow_up_due: "Send a nudge",
};

export const nextStep = (status: RequestStatus): string | null => NEXT_STEPS[status] ?? null;

function verifiedGoneAt(source: PhraseSource): string | null {
  if (source.verifiedGoneAt) return source.verifiedGoneAt;
  const [latest] = newestFirst(
    source.events?.filter((event) => event.type === "verified_gone") ?? [],
  );
  return latest?.createdAt ?? null;
}

/**
 * The words next to a request's status mark. They follow the timeline: a request still marked
 * Queued whose newest event is a failed send that will be tried again says so, instead of
 * contradicting the line below it. A removal the company only claimed says so, and one a later
 * scan found gone says when it was checked.
 */
export function statusPhrase(source: PhraseSource): StatusPhrase {
  const meta = REQUEST_STATUS_META[source.status];
  const [latest] = newestFirst(source.events ?? []);
  const retrying =
    source.retrying === true ||
    (latest?.type === "send_failed" && latest.payload.willRetry === true);
  if (source.status === "queued" && retrying) {
    return { text: "Will retry", family: "needs" };
  }
  if (source.status === "confirmed" || source.status === "no_record") {
    const checked = verifiedGoneAt(source);
    return {
      text: checked ? `Gone · checked ${formatShortDate(checked)}` : "They said removed",
      family: meta.family,
    };
  }
  return { text: meta.label, family: meta.family };
}
