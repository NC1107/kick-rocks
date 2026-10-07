import type { RequestEvent, RequestRight, UserAction } from "@kickrocks/shared";
import {
  BLOCKED_REASON_LABELS,
  CHANNEL_LABELS,
  CLASSIFICATION_LABELS,
  EMAIL_KIND_LABELS,
  FAILURE_KIND_LABELS,
  TASK_KIND_LABELS,
} from "./labels.js";
import { REQUEST_STATUS_META } from "./status.js";

const RIGHT_PHRASES: Record<RequestRight, string> = {
  opt_out: "opt out of the sale of your data",
  delete: "delete your data",
};

const QUEUED_REASONS = {
  new: "Queued to send.",
  resend: "Queued to send again.",
  follow_up: "Queued for a follow-up.",
  verification_reply: "Queued to send the details the broker asked for.",
  channel_switch: "Queued on the other channel.",
  retry: "Queued to try again.",
} as const;

const SWITCH_REASONS = {
  bounce: "because the email bounced",
  needs_form: "because the broker asked for its web form",
  user: "at your request",
} as const;

const ACTION_PHRASES: Record<UserAction, string> = {
  cancel: "cancel the request",
  resend: "send it again",
  mark_confirmed: "mark it as confirmed",
  mark_rejected: "mark it as rejected",
  mark_no_record: "mark it as having no record",
  verification_reply: "approve sending the details the broker asked for",
  retry_task: "retry the failed task",
};

const status = (value: keyof typeof REQUEST_STATUS_META) => REQUEST_STATUS_META[value].label;
const lower = (text: string) => text.toLowerCase();
const task = (kind: keyof typeof TASK_KIND_LABELS) =>
  lower(TASK_KIND_LABELS[kind]).replace(/ task$/, "");

/**
 * One sentence for a timeline event, the same on the request page and the dashboard. It reads the
 * typed payload, so a new event type or a new field fails to compile here until it has words.
 * Plain and short: no exclamation marks, no emoji.
 */
export function describeEvent(event: RequestEvent): string {
  switch (event.type) {
    case "created": {
      const { channel, rights } = event.payload;
      return `Created a request by ${lower(CHANNEL_LABELS[channel])} to ${rights.map((right) => RIGHT_PHRASES[right]).join(" and ")}.`;
    }
    case "queued":
      return QUEUED_REASONS[event.payload.reason];
    case "sent": {
      const { channel, kind } = event.payload;
      if (channel === "form") return "Submitted the web form.";
      return kind === "initial" ? "Sent the email." : `Sent the ${lower(EMAIL_KIND_LABELS[kind])}.`;
    }
    case "send_failed":
      return `Sending failed: ${event.payload.error}.${event.payload.willRetry ? " It will try again." : ""}`;
    case "reply_received":
      return `Reply received from ${event.payload.from}.`;
    case "classified": {
      const { classification, confidence } = event.payload;
      return `Classified the reply as ${lower(CLASSIFICATION_LABELS[classification])}, ${Math.round(confidence * 100)} percent sure.`;
    }
    case "link_followed":
      return event.payload.ok
        ? "Followed the confirmation link."
        : "Could not follow the confirmation link.";
    case "status_changed":
      return `Status changed from ${status(event.payload.from)} to ${status(event.payload.to)}.`;
    case "follow_up_sent":
      return `Sent follow-up number ${event.payload.number}.`;
    case "channel_switched": {
      const { from, to, reason } = event.payload;
      return `Switched from ${lower(CHANNEL_LABELS[from])} to ${lower(CHANNEL_LABELS[to])} ${SWITCH_REASONS[reason]}.`;
    }
    case "awaiting_confirmation": {
      const { fromDomains } = event.payload;
      return fromDomains.length > 0
        ? `Waiting for the confirmation email from ${fromDomains.join(" or ")}.`
        : "Waiting for the confirmation email.";
    }
    case "task_enqueued":
      return `Queued the ${task(event.payload.kind)} task.`;
    case "task_blocked": {
      const { kind, reason } = event.payload;
      return `The ${task(kind)} task stopped for you: ${lower(BLOCKED_REASON_LABELS[reason])}.`;
    }
    case "task_completed": {
      const { kind, outcome, note } = event.payload;
      const base = `The ${task(kind)} task finished${outcome ? ` (${outcome.replaceAll("_", " ")})` : ""}.`;
      return note ? `${base} You noted: ${note}` : base;
    }
    case "task_failed": {
      const { kind, error, failureKind } = event.payload;
      const why = failureKind ? ` ${FAILURE_KIND_LABELS[failureKind]}.` : "";
      return `The ${task(kind)} task failed: ${error}.${why}`;
    }
    case "task_cancelled":
      return `The ${task(event.payload.kind)} task was cancelled.`;
    case "task_resumed":
      return `The ${task(event.payload.kind)} task was resumed.`;
    case "task_retrying":
      return `The ${task(event.payload.kind)} task failed and will try again (attempt ${event.payload.attempt}).`;
    case "user_action": {
      const { action, note } = event.payload;
      return `You chose to ${ACTION_PHRASES[action]}.${note ? ` You noted: ${note}` : ""}`;
    }
    case "relisted":
      return `The record showed up again after the request was ${status(event.payload.previousStatus).toLowerCase()}.`;
    case "note":
      return event.payload.text;
  }
}
