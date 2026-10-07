import { z } from "zod";
import { MessageSummary, Reference } from "./mail.js";
import { TargetSummary } from "./targets.js";
import { TaskSummary } from "./tasks.js";
import { WebUrl } from "./url.js";

export const RequestStatus = z.enum([
  "draft",
  "queued",
  "sent",
  "awaiting_reply",
  "confirmed",
  "rejected",
  "needs_verification",
  "no_record",
  "bounced",
  "no_response",
  "follow_up_due",
  "cancelled",
]);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const RequestRight = z.enum(["opt_out", "delete"]);
export type RequestRight = z.infer<typeof RequestRight>;

export const RequestChannel = z.enum(["email", "form"]);
export type RequestChannel = z.infer<typeof RequestChannel>;

/** Who caused a change. Only a user may override the state machine. */
export const RequestActor = z.enum(["system", "user", "worker", "agent"]);
export type RequestActor = z.infer<typeof RequestActor>;

export const RequestEventType = z.enum([
  "created",
  "queued",
  "sent",
  "send_failed",
  "reply_received",
  "classified",
  "link_followed",
  "status_changed",
  "follow_up_sent",
  "channel_switched",
  "task_enqueued",
  "task_blocked",
  "task_completed",
  "task_failed",
  "user_action",
  "relisted",
  "note",
]);
export type RequestEventType = z.infer<typeof RequestEventType>;

const TERMINAL: ReadonlySet<RequestStatus> = new Set(["confirmed", "no_record", "cancelled"]);

/** Closed outcomes a person may declare by hand, whatever the machine would allow. */
const USER_OVERRIDES: ReadonlySet<RequestStatus> = new Set([
  "confirmed",
  "no_record",
  "rejected",
  "cancelled",
]);

const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["queued", "cancelled"],
  queued: ["sent", "cancelled"],
  sent: ["awaiting_reply", "bounced", "cancelled"],
  awaiting_reply: [
    "confirmed",
    "rejected",
    "needs_verification",
    "no_record",
    "bounced",
    "no_response",
    // A broker that answers "use our web form" sends the request out again on the other channel.
    "queued",
    "cancelled",
  ],
  // A rejection can be appealed by sending again with more context.
  rejected: ["queued", "cancelled"],
  // A human supplies what the broker asked for, then the request goes out again.
  needs_verification: ["sent", "cancelled"],
  no_record: [],
  // A bounce means the channel is dead; the request is re-queued on another channel.
  bounced: ["queued", "cancelled"],
  no_response: ["follow_up_due", "cancelled"],
  follow_up_due: ["queued", "cancelled"],
  confirmed: [],
  cancelled: [],
};

export interface TransitionContext {
  actor: RequestActor;
}

export function isTerminalStatus(status: RequestStatus): boolean {
  return TERMINAL.has(status);
}

/** Work is still in motion. A rejected request is closed until the user appeals it. */
export function isActiveStatus(status: RequestStatus): boolean {
  return !TERMINAL.has(status) && status !== "rejected";
}

export function canTransition(
  from: RequestStatus,
  to: RequestStatus,
  { actor }: TransitionContext,
): boolean {
  if (TRANSITIONS[from].includes(to)) return true;
  return actor === "user" && from !== to && !TERMINAL.has(from) && USER_OVERRIDES.has(to);
}

export function nextStatuses(from: RequestStatus, context: TransitionContext): RequestStatus[] {
  return RequestStatus.options.filter((to) => canTransition(from, to, context));
}

export const RequestRecord = z.object({
  id: z.string(),
  profileId: z.string(),
  targetId: z.string(),
  campaignId: z.string().nullable(),
  mailboxId: z.string().nullable(),
  rights: z.array(RequestRight).min(1),
  /** Id of the legal basis used, such as a statute id or "policy". */
  legalBasis: z.string(),
  channel: RequestChannel,
  status: RequestStatus,
  reference: Reference,
  outgoingMessageId: z.string().nullable(),
  recordUrl: WebUrl.nullable(),
  followUps: z.number().int().nonnegative(),
  sentAt: z.iso.datetime().nullable(),
  dueAt: z.iso.datetime().nullable(),
  followUpAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type RequestRecord = z.infer<typeof RequestRecord>;

export const RequestEvent = z.object({
  id: z.string(),
  requestId: z.string(),
  type: RequestEventType,
  actor: RequestActor,
  payload: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
});
export type RequestEvent = z.infer<typeof RequestEvent>;

export const RequestListItem = RequestRecord.extend({ target: TargetSummary });
export type RequestListItem = z.infer<typeof RequestListItem>;

export const RequestDetail = RequestListItem.extend({
  events: z.array(RequestEvent),
  messages: z.array(MessageSummary),
  tasks: z.array(TaskSummary),
});
export type RequestDetail = z.infer<typeof RequestDetail>;

export const RequestAction = z.enum([
  "cancel",
  "resend",
  "mark_confirmed",
  "mark_rejected",
  "mark_no_record",
]);
export type RequestAction = z.infer<typeof RequestAction>;
