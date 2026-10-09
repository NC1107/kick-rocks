import { z } from "zod";
import { OutgoingRequest, SendKind, SendRequest, SendStatus } from "./outgoing.js";
import { TaskScreenshot } from "./tasks.js";

const WorkerId = z.string().min(1).max(100);
const SendId = z.string().min(1).max(100);

export const MAX_SEND_BATCH = 100;

/** The longest a long-poll for a person's decision may last, so a request never idles for minutes. */
export const MAX_DECISION_WAIT_MS = 30_000;

/** One thing the gate decided, as a worker tells the server. */
export const SendRegistration = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["lookup", "refused", "guard_event"]),
    request: SendRequest,
    reason: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal("held"),
    request: OutgoingRequest,
    /** How long the run will wait for a person, which the server caps by its own setting. */
    holdMs: z.number().int().nonnegative(),
    screenshot: TaskScreenshot.optional(),
  }),
  /** A cleared model's send, which the server records before the request is let go. */
  z.object({ kind: z.literal("released"), request: OutgoingRequest }),
]);
export type SendRegistration = z.infer<typeof SendRegistration>;

export const SendsBody = z.object({
  workerId: WorkerId,
  /** The claim's attempt number, kept with each row for the log. */
  attempt: z.number().int().nonnegative(),
  items: z.array(SendRegistration).min(1).max(MAX_SEND_BATCH),
});
export type SendsBody = z.infer<typeof SendsBody>;

export const RegisteredSend = z.object({
  id: z.string(),
  status: SendStatus,
  expiresAt: z.iso.datetime().nullable(),
});
export type RegisteredSend = z.infer<typeof RegisteredSend>;

export const SendsResponse = z.object({ sends: z.array(RegisteredSend) });
export type SendsResponse = z.infer<typeof SendsResponse>;

export const SendParams = z.object({ id: z.string().min(1), sendId: SendId });

export const DecisionQuery = z.object({
  workerId: WorkerId,
  waitMs: z.coerce.number().int().min(0).max(MAX_DECISION_WAIT_MS).default(0),
});
export type DecisionQuery = z.infer<typeof DecisionQuery>;

/** `pending` means the person has not decided yet, and `expired` that the hold ran out. */
export const WorkerDecision = z.object({
  status: z.enum(["pending", "send", "dont_send", "expired"]),
});
export type WorkerDecision = z.infer<typeof WorkerDecision>;

/**
 * The worker is about to let a paused request go. The server checks it again, and answers ok only
 * after it has written down that the form may be out.
 */
export const ReleaseBody = z.object({
  workerId: WorkerId,
  request: OutgoingRequest,
});
export type ReleaseBody = z.infer<typeof ReleaseBody>;

export const ReleaseResponse = z.object({ ok: z.literal(true), releaseId: z.string() });
export type ReleaseResponse = z.infer<typeof ReleaseResponse>;

/** How a released request ended: the status of the answer, or the network error. */
export const SendResultBody = z.object({
  workerId: WorkerId,
  status: z.number().int().min(0).max(999).nullable(),
  error: z.string().max(500).optional(),
});
export type SendResultBody = z.infer<typeof SendResultBody>;

export const SendOk = z.object({ ok: z.literal(true) });

/** A row of the log of what the browser sent, for a person to read. */
export const SendRow = z.object({
  id: z.string(),
  attempt: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  kind: SendKind,
  status: SendStatus,
  request: SendRequest,
  reason: z.string().nullable(),
  spendsSendId: z.string().nullable(),
  hasScreenshot: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  releasedAt: z.iso.datetime().nullable(),
  responseStatus: z.number().int().nullable(),
  responseError: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** An approval for the next run of a step that already went out once in the run that was held. */
  resend: z.boolean(),
});
export type SendRow = z.infer<typeof SendRow>;

export const SendLog = z.object({
  sends: z.array(SendRow),
  /** Placeholder to the person's value, for showing a request the way the person typed it. */
  values: z.record(z.string(), z.string()),
  /** The row that started the latest run, so the panel can tell the live rows from the old ones. */
  runStartedSeq: z.number().int().nonnegative(),
});
export type SendLog = z.infer<typeof SendLog>;

export const SendDecisionBody = z.object({ decision: z.enum(["send", "dont_send"]) });
export type SendDecisionBody = z.infer<typeof SendDecisionBody>;

export const ApproveSendsBody = z.object({
  /** Held requests the person does not want sent in the next run. */
  declineSendIds: z.array(SendId).max(MAX_SEND_BATCH).default([]),
});
export type ApproveSendsBody = z.infer<typeof ApproveSendsBody>;
