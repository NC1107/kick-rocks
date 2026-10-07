import { z } from "zod";
import { ProfileField } from "./identities.js";
import { EmailKind } from "./mail.js";
import { BlockedReason, FailureKind, FormOutcome } from "./outcomes.js";
import { Recipe } from "./recipe.js";
import { RequestRight } from "./rights.js";
import { TargetSummary } from "./targets.js";
import { WebUrl } from "./url.js";

export const TaskKind = z.enum([
  "email_send",
  "inbox_poll",
  "scan",
  "form",
  "confirm",
  "canary",
  "agent",
]);
export type TaskKind = z.infer<typeof TaskKind>;

/** Work the server does itself. */
export const IN_PROCESS_TASK_KINDS = [
  "email_send",
  "inbox_poll",
] as const satisfies readonly TaskKind[];
export type InProcessTaskKind = (typeof IN_PROCESS_TASK_KINDS)[number];

/** Work that needs a browser or an agent, claimed by the built-in worker or an MCP client. */
export const BROWSER_TASK_KINDS = [
  "scan",
  "form",
  "confirm",
  "canary",
  "agent",
] as const satisfies readonly TaskKind[];
export type BrowserTaskKind = (typeof BROWSER_TASK_KINDS)[number];
export const BrowserTaskKind = z.enum(BROWSER_TASK_KINDS);

export const TaskStatus = z.enum(["queued", "leased", "done", "blocked", "failed", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** A task in one of these states still occupies its dedupe key. */
export const LIVE_TASK_STATUSES = [
  "queued",
  "leased",
  "blocked",
] as const satisfies readonly TaskStatus[];

export const TaskLease = z.object({
  owner: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
export type TaskLease = z.infer<typeof TaskLease>;

const id = z.string().min(1);

/** Payloads hold ids only. Personal data is resolved from the profile when a task is claimed. */
export const EmailSendPayload = z
  .object({
    requestId: id,
    /** Initial, a follow-up, or a verification reply. Set by whoever queues the send, never guessed. */
    kind: EmailKind,
    /**
     * For a verification reply, the identifiers the person approved, as field names. Names are not
     * personal data; the values are resolved when the mail is composed.
     */
    fields: z.array(ProfileField).default([]),
    /** The Message-ID of the broker's message a verification reply answers. */
    inReplyTo: z.string().nullable(),
  })
  .refine((payload) => (payload.kind === "verification_reply") === payload.fields.length > 0, {
    message: "A verification reply names the approved fields, and no other email does",
    path: ["fields"],
  });
export const InboxPollPayload = z.object({ mailboxId: id });

/**
 * A scan can search under a past name or address, since listings are keyed by old names and
 * cities. Null means the current primary identity, and the ids point at identities of the profile.
 */
export const ScanVariant = z.object({ nameId: id.nullable(), addressId: id.nullable() });
export type ScanVariant = z.infer<typeof ScanVariant>;

export const ScanPayload = z.object({
  profileId: id,
  targetId: id,
  recipeId: z.string().nullable(),
  variant: ScanVariant.nullable(),
});
export const FormPayload = z.object({
  requestId: id,
  targetId: id,
  recipeId: z.string().nullable(),
  recordUrl: WebUrl.nullable(),
});
export const ConfirmPayload = z.object({ requestId: id, url: WebUrl });
export const CanaryPayload = z.object({ recipeId: id });

/** Why work went to an agent: no recipe exists, the recipe broke, or a human check stopped the worker. */
export const AgentReason = z.enum(["no_recipe", "recipe_failed", "blocked"]);
export type AgentReason = z.infer<typeof AgentReason>;

export const AgentPayload = z.object({
  purpose: z.enum(["scan", "remove"]),
  profileId: id,
  targetId: id,
  requestId: z.string().nullable(),
  recordUrl: WebUrl.nullable(),
  variant: ScanVariant.nullable(),
  /** What a removal asks for, so the agent knows whether this is an opt-out or a deletion. Empty for a scan. */
  rights: z.array(RequestRight).default(() => []),
  reason: AgentReason,
  previousError: z.string().nullable(),
  /** For reason `blocked`, the human check that stopped the earlier run. */
  blockedReason: BlockedReason.nullable(),
});

export const TASK_PAYLOAD_SCHEMAS = {
  email_send: EmailSendPayload,
  inbox_poll: InboxPollPayload,
  scan: ScanPayload,
  form: FormPayload,
  confirm: ConfirmPayload,
  canary: CanaryPayload,
  agent: AgentPayload,
} as const satisfies Record<TaskKind, z.ZodType>;

export type TaskPayloadMap = { [K in TaskKind]: z.infer<(typeof TASK_PAYLOAD_SCHEMAS)[K]> };

export function parseTaskPayload<K extends TaskKind>(kind: K, raw: unknown): TaskPayloadMap[K] {
  return TASK_PAYLOAD_SCHEMAS[kind].parse(raw) as TaskPayloadMap[K];
}

export const Candidate = z.object({
  recordUrl: WebUrl,
  name: z.string().min(1),
  age: z.number().int().nonnegative().optional(),
  locations: z.array(z.string()),
  relatives: z.array(z.string()).optional(),
  phones: z.array(z.string()).optional(),
  emails: z.array(z.string()).optional(),
});
export type Candidate = z.infer<typeof Candidate>;

export const ScanResult = z.object({ candidates: z.array(Candidate) });
export type ScanResult = z.infer<typeof ScanResult>;

/** A host name, never an address, so it can be compared with the sender of a confirmation email. */
const SenderDomain = z.string().regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i);

export const FormResult = z.object({
  outcome: FormOutcome,
  confirmationText: z.string().optional(),
  /**
   * For `awaiting_email_confirmation`, the domain the confirmation email will come from, when the
   * page says so. A broker's confirmation often comes from a sister site, such as PeopleConnect
   * sending for Intelius, and carries no reference of ours.
   */
  confirmationFrom: SenderDomain.optional(),
  notes: z.string().optional(),
});
export type FormResult = z.infer<typeof FormResult>;

export const ConfirmResult = z.object({
  confirmed: z.boolean(),
  finalUrl: z.string(),
  notes: z.string().optional(),
});
export type ConfirmResult = z.infer<typeof ConfirmResult>;

export const CanaryResult = z.object({
  healthy: z.boolean(),
  missingSelectors: z.array(z.string()),
});
export type CanaryResult = z.infer<typeof CanaryResult>;

const AgentScanResult = z.object({ purpose: z.literal("scan"), scan: ScanResult });
const AgentRemoveResult = z.object({ purpose: z.literal("remove"), form: FormResult });

export const AgentResult = z.discriminatedUnion("purpose", [AgentScanResult, AgentRemoveResult]);
export type AgentResult = z.infer<typeof AgentResult>;

/** In-process runners report whatever is useful for the audit trail; nothing reads it back. */
export const InProcessResult = z.record(z.string(), z.json());
export type InProcessResult = z.infer<typeof InProcessResult>;

export const TASK_RESULT_SCHEMAS = {
  email_send: InProcessResult,
  inbox_poll: InProcessResult,
  scan: ScanResult,
  form: FormResult,
  confirm: ConfirmResult,
  canary: CanaryResult,
  agent: AgentResult,
} as const satisfies Record<TaskKind, z.ZodType>;

export type TaskResultMap = { [K in TaskKind]: z.infer<(typeof TASK_RESULT_SCHEMAS)[K]> };

export function parseTaskResult<K extends TaskKind>(kind: K, raw: unknown): TaskResultMap[K] {
  return TASK_RESULT_SCHEMAS[kind].parse(raw) as TaskResultMap[K];
}

/**
 * The schema a task's result must match, which depends on the task and not on what the caller
 * says it is. An agent task reports the result of its own purpose, so a scan task cannot be
 * completed with a removal outcome that a handler would then apply to a request it does not have.
 */
export function resultSchemaFor(task: { kind: TaskKind; payload: unknown }): z.ZodType {
  if (task.kind === "agent") {
    return agentPurpose(task.payload) === "scan" ? AgentScanResult : AgentRemoveResult;
  }
  return TASK_RESULT_SCHEMAS[task.kind];
}

/** Reads only the purpose of an agent payload, which is all a result depends on. */
function agentPurpose(payload: unknown): AgentPayloadPurpose {
  return AgentPayload.shape.purpose.parse((payload as { purpose?: unknown } | null)?.purpose);
}
type AgentPayloadPurpose = z.infer<typeof AgentPayload>["purpose"];

/**
 * The result a person supplies when they finish a blocked task by hand. For an agent task they
 * give the plain scan or form result, and `toTaskResult` wraps it the way an agent would have.
 */
export function manualResultSchemaFor(task: { kind: TaskKind; payload: unknown }): z.ZodType {
  if (task.kind === "agent") {
    return agentPurpose(task.payload) === "scan" ? ScanResult : FormResult;
  }
  return TASK_RESULT_SCHEMAS[task.kind];
}

export function toTaskResult(task: { kind: TaskKind; payload: unknown }, manual: unknown): unknown {
  if (task.kind !== "agent") return manual;
  return agentPurpose(task.payload) === "scan"
    ? { purpose: "scan", scan: manual }
    : { purpose: "remove", form: manual };
}

const claimedBase = {
  id,
  attempt: z.number().int().positive(),
  leaseExpiresAt: z.iso.datetime(),
  target: TargetSummary,
  /** Whose task it is, so a worker keeps each person's browser sessions apart. Null for a canary. */
  profileId: z.string().nullable().optional(),
  recipe: Recipe.nullable(),
  /** Only what the recipe declares, or for agent tasks what the legal package allows. */
  fields: z.partialRecord(ProfileField, z.string()),
  instructions: z.string(),
};

function claimed<K extends BrowserTaskKind>(kind: K, payload: (typeof TASK_PAYLOAD_SCHEMAS)[K]) {
  return z.object({ ...claimedBase, kind: z.literal(kind), payload });
}

/** What a worker or agent receives when it claims a task. */
export const ClaimedTask = z.discriminatedUnion("kind", [
  claimed("scan", ScanPayload),
  claimed("form", FormPayload),
  claimed("confirm", ConfirmPayload),
  claimed("canary", CanaryPayload),
  claimed("agent", AgentPayload),
]);
export type ClaimedTask = z.infer<typeof ClaimedTask>;

/**
 * Who took a task: the built-in worker, an MCP client, or a model-backed worker. Set by the route
 * that claimed it, so a client cannot choose how it is counted.
 */
export const ClaimerKind = z.enum(["builtin", "mcp", "model"]);
export type ClaimerKind = z.infer<typeof ClaimerKind>;

/** What a run cost, reported by whoever did it, so success and cost can be measured per worker type. */
export const TaskUsage = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type TaskUsage = z.infer<typeof TaskUsage>;

/** A task without its payload or result, safe to list and to show to an agent. */
export const TaskSummary = z.object({
  id: z.string(),
  kind: TaskKind,
  status: TaskStatus,
  priority: z.number().int(),
  profileId: z.string().nullable(),
  targetId: z.string().nullable(),
  targetName: z.string().nullable(),
  requestId: z.string().nullable(),
  blockedReason: BlockedReason.nullable(),
  blockedDetail: z.string().nullable(),
  /** The page where the worker got stuck, when it said. */
  blockedUrl: WebUrl.nullable(),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  lastError: z.string().nullable(),
  /** What broke in the last failure, so a broken recipe can be told from a broker outage. */
  failureKind: FailureKind.nullable(),
  failureStep: z.number().int().nonnegative().nullable(),
  hasScreenshot: z.boolean(),
  /** The worker that last ended its lease on the task, and the kind of claimer it was. */
  finishedBy: z.string().nullable(),
  claimerKind: ClaimerKind.nullable(),
  /** Summed over every attempt. */
  usage: TaskUsage.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TaskSummary = z.infer<typeof TaskSummary>;

export const SCREENSHOT_MIME_TYPES = ["image/png", "image/jpeg"] as const;

/** Largest screenshot accepted, in bytes of the decoded image. */
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

/** The most a request carrying one screenshot as base64 can weigh, with room for the rest of the body. */
export const SCREENSHOT_BODY_LIMIT_BYTES = Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 64 * 1024;

export const TaskScreenshot = z.object({
  mime: z.enum(SCREENSHOT_MIME_TYPES),
  dataBase64: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 4),
});
export type TaskScreenshot = z.infer<typeof TaskScreenshot>;

/** The shared shape of "park this task for a human", used by the worker API and MCP. */
export const TaskBlockReport = z.object({
  reason: BlockedReason,
  detail: z.string().max(2000).optional(),
  /** The page the person should open to finish by hand, which is where the run got stuck. */
  url: WebUrl.optional(),
  screenshot: TaskScreenshot.optional(),
  usage: TaskUsage.optional(),
});
export type TaskBlockReport = z.infer<typeof TaskBlockReport>;

/**
 * "This task failed". A `recipe` failure is never retried, whatever `retryable` says, because the
 * same script would fail the same way; the server hands it to an agent and counts it against the
 * recipe. Other kinds are retried with a backoff while attempts remain, when `retryable` is set.
 */
export const TaskFailureReport = z.object({
  error: z.string().min(1).max(2000),
  retryable: z.boolean(),
  kind: FailureKind.default("internal"),
  /** The index of the recipe step that failed, for a `recipe` failure. */
  step: z.number().int().nonnegative().optional(),
  retryAfterMs: z
    .number()
    .int()
    .nonnegative()
    .max(24 * 60 * 60 * 1000)
    .optional(),
  usage: TaskUsage.optional(),
});
export type TaskFailureReport = z.infer<typeof TaskFailureReport>;

/**
 * A person finishing a blocked task by hand. The result says how it ended and is validated like
 * the one a worker would have sent: a form outcome for a removal, candidates for a scan, and for
 * an agent task the result of its own purpose. Leave it out when the outcome does not matter.
 */
export const TaskMarkDoneBody = z.object({
  result: z.unknown().optional(),
  note: z.string().max(2000).optional(),
});
export type TaskMarkDoneBody = z.infer<typeof TaskMarkDoneBody>;

export const LEASE_MS = { min: 10_000, max: 60 * 60 * 1000, default: 5 * 60 * 1000 } as const;
export const LeaseMs = z.number().int().min(LEASE_MS.min).max(LEASE_MS.max);
