import { z } from "zod";
import { ProfileField } from "./identities.js";
import { EmailKind, MessageSummary, Reference, ReplyClassification } from "./mail.js";
import { BlockedReason, FailureKind, type FormOutcome } from "./outcomes.js";
import { TargetSummary } from "./targets.js";
import { TaskKind, TaskSummary } from "./tasks.js";
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

/** At least one right, each at most once. */
export const RequestRights = z
  .array(RequestRight)
  .min(1)
  .refine((rights) => new Set(rights).size === rights.length, {
    message: "Rights must be unique",
  });
export type RequestRights = z.infer<typeof RequestRights>;

export const RequestChannel = z.enum(["email", "form"]);
export type RequestChannel = z.infer<typeof RequestChannel>;

/** Who caused a change. Only a user may override the state machine. */
export const RequestActor = z.enum(["system", "user", "worker", "agent"]);
export type RequestActor = z.infer<typeof RequestActor>;

export const RequestAction = z.enum([
  "cancel",
  "resend",
  "mark_confirmed",
  "mark_rejected",
  "mark_no_record",
]);
export type RequestAction = z.infer<typeof RequestAction>;

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
  "awaiting_confirmation",
  "task_enqueued",
  "task_blocked",
  "task_completed",
  "task_failed",
  "task_cancelled",
  "task_resumed",
  "task_retrying",
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

/**
 * Where a request may go besides the closed outcomes a user can force. A reply or a form result
 * is applied to whatever status the request is in when it arrives, so every status that can be
 * waiting on one lists each outcome it can bring: confirmed, no_record, rejected,
 * needs_verification, bounced, awaiting_reply, and queued (a channel switch).
 */
const LATE_OUTCOMES = [
  "awaiting_reply",
  "confirmed",
  "rejected",
  "needs_verification",
  "no_record",
  "bounced",
  "queued",
] as const satisfies readonly RequestStatus[];

const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["queued", "cancelled"],
  // The email runner moves queued -> sent -> awaiting_reply in one call, and a form run moves
  // queued straight to its outcome, so a form that finds nothing never writes a `sent` event.
  // A bounce can arrive while a follow-up or resend waits to go out, and then nothing is left to send.
  queued: [
    "sent",
    "awaiting_reply",
    "bounced",
    "confirmed",
    "no_record",
    "rejected",
    "needs_verification",
    "cancelled",
  ],
  // A resting state only for a moment, but a reply can arrive in it, so it can end in any outcome.
  sent: [
    "awaiting_reply",
    "bounced",
    "confirmed",
    "rejected",
    "needs_verification",
    "no_record",
    "queued",
    "cancelled",
  ],
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
  // A rejection can be appealed by sending again, and a late answer can still overturn it.
  rejected: ["queued", "confirmed", "no_record", "cancelled"],
  // The verification reply goes out through the queue like any other send, so the way back is
  // queued, and a broker that answers instead of waiting can close the request.
  needs_verification: [
    ...LATE_OUTCOMES.filter((status) => status !== "needs_verification"),
    "no_response",
    "cancelled",
  ],
  no_record: [],
  // A bounce means the channel is dead; the request is re-queued on another channel.
  bounced: ["queued", "cancelled"],
  // A broker may answer long after the deadline, so a late reply is applied like any other.
  no_response: [...LATE_OUTCOMES, "follow_up_due", "cancelled"],
  follow_up_due: [...LATE_OUTCOMES, "cancelled"],
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

/**
 * The status a classified reply moves a request to, or null when the reply changes nothing and
 * is only recorded. The inbox runner applies a reply when `canTransition` allows the move from
 * the request's current status, and records it without a status change when it does not, so a
 * reply that arrives too late or too early is never lost and never forces an illegal move.
 * A `confirmation_link` changes nothing here: following the link, or a `confirm` task, does the
 * work, and the next reply says whether it took.
 */
export const REPLY_OUTCOMES: Record<ReplyClassification, RequestStatus | null> = {
  bounce: "bounced",
  auto_ack: null,
  confirmation_link: null,
  verification_required: "needs_verification",
  completed: "confirmed",
  no_record: "no_record",
  rejected: "rejected",
  needs_form: "queued",
  unrelated: null,
  unknown: null,
};

/**
 * The status a finished form run moves its request to, applied while the request is `queued`.
 * A run that submitted the form, or that is waiting for the confirmation email, leaves the request
 * waiting for the broker's answer. Both "no such record" and "already removed" close it, because
 * either way nothing is left to remove.
 */
export const FORM_OUTCOMES: Record<FormOutcome, RequestStatus> = {
  submitted: "awaiting_reply",
  awaiting_email_confirmation: "awaiting_reply",
  not_found: "no_record",
  already_removed: "no_record",
};

/**
 * The kind of email a manual resend sends from a status. A request that already went out and
 * got no answer is nudged with a follow-up; one that was rejected or bounced is sent again as if
 * new. A verification reply is never a resend: it has its own route, because it needs the fields
 * the person approved.
 */
export function resendEmailKind(status: RequestStatus): EmailKind {
  return status === "awaiting_reply" || status === "no_response" || status === "follow_up_due"
    ? "follow_up"
    : "initial";
}

const RESENDABLE: ReadonlySet<RequestStatus> = new Set([
  "rejected",
  "bounced",
  "no_response",
  "follow_up_due",
  "awaiting_reply",
]);

export interface ActionContext {
  /** A task for this request is queued, running, or blocked. */
  hasLiveTask: boolean;
}

/**
 * The actions a person may take on a request right now, which the server accepts and the UI
 * offers, so neither re-derives the rules.
 *
 * `resend` queues the request again on its current channel, and is offered when the request went
 * out and was rejected, bounced, or went unanswered, or is awaiting a reply, or is queued with
 * nothing live to send it. It is not offered while the request is `sent` or `needs_verification`.
 * The other actions force an outcome and are offered whenever the machine lets a user do so.
 */
export function availableActions(
  request: { status: RequestStatus },
  { hasLiveTask }: ActionContext,
): RequestAction[] {
  const user = { actor: "user" } as const;
  const { status } = request;
  const allowed: Record<RequestAction, boolean> = {
    cancel: canTransition(status, "cancelled", user),
    resend: RESENDABLE.has(status) || (status === "queued" && !hasLiveTask),
    mark_confirmed: canTransition(status, "confirmed", user),
    mark_rejected: canTransition(status, "rejected", user),
    mark_no_record: canTransition(status, "no_record", user),
  };
  return RequestAction.options.filter((action) => allowed[action]);
}

export const RequestRecord = z.object({
  id: z.string(),
  profileId: z.string(),
  targetId: z.string(),
  campaignId: z.string().nullable(),
  mailboxId: z.string().nullable(),
  rights: RequestRights,
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
  /**
   * Set while a submitted form waits for the broker's confirmation email, and null otherwise. A
   * confirmation link from an expected sender matches the oldest request waiting like this.
   */
  awaitingConfirmationSince: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type RequestRecord = z.infer<typeof RequestRecord>;

/** What a person did by hand, as recorded on the timeline. */
export const UserAction = z.enum([...RequestAction.options, "verification_reply", "retry_task"]);
export type UserAction = z.infer<typeof UserAction>;

const TaskRef = { taskId: z.string(), kind: TaskKind };

/**
 * What each timeline event carries. The server validates a payload when it writes an event, the
 * web mock builds fixtures from the same schemas, and `describeEvent` in the web app turns any of
 * them into a sentence, so no module invents a shape the others cannot read.
 */
export const REQUEST_EVENT_PAYLOADS = {
  created: z.object({ channel: RequestChannel, rights: RequestRights, reference: Reference }),
  queued: z.object({
    channel: RequestChannel,
    reason: z.enum(["new", "resend", "follow_up", "verification_reply", "channel_switch", "retry"]),
  }),
  sent: z.object({
    channel: RequestChannel,
    kind: EmailKind,
    /** The Message-ID of the email; null when the request went out through a web form. */
    messageId: z.string().nullable(),
    mailboxId: z.string().nullable(),
  }),
  send_failed: z.object({ error: z.string(), willRetry: z.boolean() }),
  reply_received: z.object({ messageId: z.string(), from: z.string(), subject: z.string() }),
  classified: z.object({
    messageId: z.string(),
    classification: ReplyClassification,
    confidence: z.number().min(0).max(1),
    correlation: z.enum(["message_id", "reference", "sender_domain", "manual"]).nullable(),
  }),
  link_followed: z.object({ url: WebUrl, finalUrl: WebUrl.nullable(), ok: z.boolean() }),
  status_changed: z.object({ from: RequestStatus, to: RequestStatus }),
  follow_up_sent: z.object({ messageId: z.string().nullable(), number: z.number().int().min(1) }),
  channel_switched: z.object({
    from: RequestChannel,
    to: RequestChannel,
    reason: z.enum(["bounce", "needs_form", "user"]),
  }),
  awaiting_confirmation: z.object({
    fromDomains: z.array(z.string()),
    linkTextPattern: z.string().nullable(),
  }),
  task_enqueued: z.object(TaskRef),
  task_blocked: z.object({ ...TaskRef, reason: BlockedReason, detail: z.string().nullable() }),
  task_completed: z.object({
    ...TaskRef,
    outcome: z.string().nullable(),
    /** What the person wrote when they finished the task by hand. */
    note: z.string().nullable(),
  }),
  task_failed: z.object({ ...TaskRef, error: z.string(), failureKind: FailureKind.nullable() }),
  task_cancelled: z.object(TaskRef),
  task_resumed: z.object(TaskRef),
  task_retrying: z.object({ ...TaskRef, error: z.string(), attempt: z.number().int().min(1) }),
  user_action: z.object({ action: UserAction, note: z.string().nullable() }),
  relisted: z.object({ recordUrl: WebUrl.nullable(), previousStatus: RequestStatus }),
  note: z.object({ text: z.string() }),
} as const satisfies Record<RequestEventType, z.ZodType>;

export type RequestEventPayloads = {
  [T in RequestEventType]: z.infer<(typeof REQUEST_EVENT_PAYLOADS)[T]>;
};

/** An event to write: its type decides the shape of its payload. */
export type RequestEventDraft = {
  [T in RequestEventType]: { type: T; payload: RequestEventPayloads[T] };
}[RequestEventType];

/** Throws when the payload is not what the event type carries. */
export function parseEventPayload<T extends RequestEventType>(
  type: T,
  payload: unknown,
): RequestEventPayloads[T] {
  return REQUEST_EVENT_PAYLOADS[type].parse(payload) as RequestEventPayloads[T];
}

const eventFields = {
  id: z.string(),
  requestId: z.string(),
  actor: RequestActor,
  createdAt: z.iso.datetime(),
};

const P = REQUEST_EVENT_PAYLOADS;

/**
 * A timeline event, a union on `type` so its payload is typed by what happened. `extra` adds
 * fields to every variant, which is how the dashboard's recent events carry the request reference.
 */
export function requestEventSchema<E extends z.ZodRawShape>(extra: E) {
  const eventOf = <T extends RequestEventType, Payload extends z.ZodType>(
    type: T,
    payload: Payload,
  ) => z.object({ ...eventFields, ...extra, type: z.literal(type), payload });

  return z.discriminatedUnion("type", [
    eventOf("created", P.created),
    eventOf("queued", P.queued),
    eventOf("sent", P.sent),
    eventOf("send_failed", P.send_failed),
    eventOf("reply_received", P.reply_received),
    eventOf("classified", P.classified),
    eventOf("link_followed", P.link_followed),
    eventOf("status_changed", P.status_changed),
    eventOf("follow_up_sent", P.follow_up_sent),
    eventOf("channel_switched", P.channel_switched),
    eventOf("awaiting_confirmation", P.awaiting_confirmation),
    eventOf("task_enqueued", P.task_enqueued),
    eventOf("task_blocked", P.task_blocked),
    eventOf("task_completed", P.task_completed),
    eventOf("task_failed", P.task_failed),
    eventOf("task_cancelled", P.task_cancelled),
    eventOf("task_resumed", P.task_resumed),
    eventOf("task_retrying", P.task_retrying),
    eventOf("user_action", P.user_action),
    eventOf("relisted", P.relisted),
    eventOf("note", P.note),
  ]);
}

export const RequestEvent = requestEventSchema({});
export type RequestEvent = z.infer<typeof RequestEvent>;

export const RequestListItem = RequestRecord.extend({ target: TargetSummary });
export type RequestListItem = z.infer<typeof RequestListItem>;

export const RequestDetail = RequestListItem.extend({
  events: z.array(RequestEvent),
  messages: z.array(MessageSummary),
  tasks: z.array(TaskSummary),
  /** What the person may do now, from `availableActions`, so the page never offers a button that answers 409. */
  actions: z.array(RequestAction),
});
export type RequestDetail = z.infer<typeof RequestDetail>;

/** The approved reply to a broker that asked for more identifiers. */
export const VerificationReplyBody = z.object({
  /** The broker's message that asked, which says what it wants. */
  messageId: z.string().min(1),
  /** The identifiers the person approves sending: a subset of what the message asked for. */
  fields: z.array(ProfileField).min(1),
});
export type VerificationReplyBody = z.infer<typeof VerificationReplyBody>;
