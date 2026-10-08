import {
  isOutgoingRequest,
  type OutgoingRequest,
  type OutgoingValue,
  type SendLog,
  type SendRow,
} from "@kickrocks/shared";
import { PROFILE_FIELD_LABELS } from "../../lib/labels.js";

/** What the gate cannot see, in the words every approval shows. One list, so no two places differ. */
export const GATE_LIMITS: readonly { title: string; text: string }[] = [
  {
    title: "A value the page disguises itself",
    text: "Bodies are all held after the run touched the page, and other sites are refused, so a value hidden by a transform of the page's own (its own hash, or one character per request) could only travel in a GET to the target's own site.",
  },
  {
    title: "Searches that carry no contact detail",
    text: "A GET with only a name, city, state, ZIP or year, and a removal link with nothing of yours in it, are not held. They are listed under What left the browser as lookups.",
  },
  {
    title: "Names that leak through DNS",
    text: "A page can look up an encoded host name before it is allowed to send anything. The gate does not see that.",
  },
  {
    title: "Sites that need a live connection",
    text: "A WebSocket, WebRTC, WebTransport or a shared worker is blocked, not read. A site that needs one cannot be finished by a model that has not passed the gate.",
  },
  {
    title: "Bot sensors",
    text: "A sensor on the broker's own domain posts a body that holds none of your details we can read. It is held like any other send. If you decline it, the site may reject the form.",
  },
  {
    title: "A body that cannot be read",
    text: "A stream, a file, or a body over 2 MB cannot be shown to you, so it cannot be approved. Finish by hand.",
  },
  {
    title: "Requests that change on every load",
    text: "A timestamp or an id the page makes up cannot be replayed in the next run, so the request is held again. The panel shows what changed. Approving while the run waits avoids this.",
  },
  {
    title: "Clearing the site's storage",
    text: "A model that has not passed the gate starts each removal with the target's cookies and storage cleared. The site may ask for more bot checks, and any sign-in there is gone.",
  },
  {
    title: "A hold takes the worker",
    text: "While a request waits for you the agent worker does nothing else. It gives up after the hold time in Settings, and the request waits for the next run.",
  },
  {
    title: "False alarms",
    text: "The gate would rather hold a harmless request than miss one with your details in it, so it can break a page. The model is told, and the refusal is in the log.",
  },
];

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** Puts the person's own values back where a placeholder stands, for showing a request to them. */
export function restore(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER, (whole) => values[whole] ?? whole);
}

export function isHeld(row: SendRow): row is SendRow & { request: OutgoingRequest } {
  return row.kind === "held" && isOutgoingRequest(row.request);
}

/** The rows of the run that is on now, or the one that ended last: what a person decides about. */
export function latestRun(log: Pick<SendLog, "sends" | "runStartedSeq">): SendRow[] {
  return log.sends.filter((row) => row.seq >= log.runStartedSeq);
}

/** Requests waiting for a person while the run is still going. */
export function liveHolds(log: SendLog, now: number): SendRow[] {
  return latestRun(log).filter(
    (row) =>
      isHeld(row) &&
      row.status === "pending_live" &&
      (row.expiresAt === null || Date.parse(row.expiresAt) > now),
  );
}

/** Requests the last run held and let lapse, and any it was already approved to send again. */
export function nextRunHolds(log: SendLog): SendRow[] {
  return latestRun(log).filter(
    (row) =>
      isHeld(row) && (row.status === "awaiting_next_run" || row.status === "approved_next_run"),
  );
}

/**
 * Steps of a multi-step form that already went out in the run that lapsed. Approving the run again
 * sends them again, because the form cannot reach the step that lapsed without them.
 */
export function carriedSteps(log: Pick<SendLog, "sends" | "runStartedSeq">): SendRow[] {
  return latestRun(log).filter(
    (row) => isHeld(row) && row.status === "sent" && row.releasedAt !== null,
  );
}

export function kindLabel(request: OutgoingRequest): string {
  return request.isDocument ? "Form submission (page load)" : "Background request";
}

export interface Destination {
  /** Host and path, with the person's values still hidden. */
  text: string;
  /** Not the target's own site, which the person should notice at once. */
  offSite: boolean;
}

export function destinationOf(request: OutgoingRequest): Destination {
  return { text: `${request.host}${request.path}`, offSite: request.party === "third" };
}

export function frameLabel(request: OutgoingRequest): string {
  const { type, frameOrigin, topLevel } = request.target;
  if (type === "worker") return `a worker of ${frameOrigin || "the page"}`;
  if (topLevel) return "this page";
  return `a frame of ${frameOrigin || "another site"}`;
}

export interface Badge {
  text: string;
  /** Attention for what the person must look at, neutral for what is routine. */
  tone: "neutral" | "attention";
}

const FIELD_NOUNS: Record<string, string> = {
  other: "private detail",
};

function noun(field: string): string {
  if (field in FIELD_NOUNS) return FIELD_NOUNS[field] ?? field;
  const label = PROFILE_FIELD_LABELS[field as keyof typeof PROFILE_FIELD_LABELS];
  return (label ?? field).toLowerCase();
}

export function badgesOf(value: OutgoingValue): Badge[] {
  if (value.class === "profile") {
    return (value.fields ?? []).map((field) => ({
      text: `your ${noun(field)}`,
      tone: "attention",
    }));
  }
  if (value.class === "served_token") {
    return [{ text: "set by the site, may change next run", tone: "neutral" }];
  }
  return [];
}

export interface FieldRow {
  where: "address" | "header" | "body";
  name: string;
  value: string;
  badges: Badge[];
}

/** Every name and value that would leave, with the person's values put back. */
export function fieldRows(request: OutgoingRequest, values: Readonly<Record<string, string>>) {
  const rows: FieldRow[] = [];
  const add = (where: FieldRow["where"], list: readonly OutgoingValue[]) => {
    for (const value of list) {
      rows.push({
        where,
        name: value.path === "" ? "(whole body)" : value.path,
        value: restore(value.value, values),
        badges: badgesOf(value),
      });
    }
  };
  add("address", request.query);
  add("header", request.headers);
  add("body", request.body);
  return rows;
}

/** An opaque body, or one that holds nothing of the person that the gate could read. */
export function unreadableNote(request: OutgoingRequest): string | null {
  if (request.bodyKind === "opaque") return "contains none of your details we can read";
  if (request.bodyBytes > 0 && request.carries.length === 0) {
    return "contains none of your details we can read";
  }
  return null;
}

/** "9:42" for a hold with 9 minutes and 42 seconds left. */
export function countdown(expiresAt: string | null, now: number): string | null {
  if (expiresAt === null) return null;
  const left = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

const REFUSAL_TEXT: Record<string, string> = {
  third_party_value: "Blocked: it carried your details to another site",
  third_party_after_touch: "Blocked: another site, after the run started filling the form",
  unreadable_body: "Blocked: the body could not be read, so it cannot be approved",
  declined: "Blocked: you declined this request earlier",
  after_run: "Blocked: the page sent it after the run was over",
  websocket: "Blocked: a live connection",
};

export function refusalText(reason: string | null): string {
  return (reason && REFUSAL_TEXT[reason]) || "Blocked by the safety gate";
}

const HELD_STATUS_TEXT: Record<string, string> = {
  pending_live: "Waiting for you",
  sent: "You approved it",
  declined: "You declined it",
  withdrawn: "The page took it back",
  awaiting_next_run: "Held for the next run",
  approved_next_run: "Approved for the next run",
  spent: "Sent in a later run",
  unused: "Approval not used",
};

export function heldStatusText(status: string): string {
  return HELD_STATUS_TEXT[status] ?? status;
}

export interface LogSummary {
  /** Requests carrying the person's details that were let go. */
  released: number;
  /** A channel the gate cannot read was used, so a form may have gone out. */
  unguarded: boolean;
  /** Nothing carrying the person's details left the browser. */
  nothingLeft: boolean;
}

export function summarize(log: Pick<SendLog, "sends">): LogSummary {
  const released = log.sends.filter((row) => row.kind === "released").length;
  const unguarded = log.sends.some(
    (row) => row.kind === "guard_event" && row.reason?.startsWith("unguarded:") === true,
  );
  return { released, unguarded, nothingLeft: released === 0 && !unguarded };
}

/** What a person reads for a row of the log: a short title and the line under it. */
export function logLine(
  row: SendRow,
  values: Readonly<Record<string, string>>,
): { title: string; detail: string } {
  if (!isOutgoingRequest(row.request)) {
    return { title: restore(row.request.note, values), detail: "" };
  }
  const request = row.request;
  const where = `${request.method} ${request.host}${request.path}`;
  const carried = request.carries.length
    ? `with ${request.carries.map((field) => noun(field)).join(", ")}`
    : "with nothing of yours";
  switch (row.kind) {
    case "lookup":
      return { title: "Looked something up", detail: `${where}, ${carried}` };
    case "released":
      return {
        title: row.status === "failed" ? "Sent, then failed" : "Sent",
        detail: `${where}, ${carried}${row.responseStatus === null ? "" : `, answered ${row.responseStatus}`}`,
      };
    case "refused":
      return { title: refusalText(row.reason), detail: where };
    case "held":
      return { title: heldStatusText(row.status), detail: `${where}, ${carried}` };
    default:
      return { title: row.reason ?? "Note", detail: where };
  }
}
