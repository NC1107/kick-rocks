import { z } from "zod";
import { ProfileField } from "./identities.js";
import { Recipe } from "./recipe.js";
import { TargetSummary } from "./targets.js";

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

export const BlockedReason = z.enum([
  "captcha",
  "phone_verification",
  "id_upload",
  "email_verification",
  "login_required",
  "bot_detection",
  "recipe_failed",
  "unknown",
]);
export type BlockedReason = z.infer<typeof BlockedReason>;

export const TaskLease = z.object({
  owner: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
export type TaskLease = z.infer<typeof TaskLease>;

const id = z.string().min(1);
const WebUrl = z.url({ protocol: /^https?$/ });

/** Payloads hold ids only. Personal data is resolved from the profile when a task is claimed. */
export const EmailSendPayload = z.object({ requestId: id, followUp: z.boolean() });
export const InboxPollPayload = z.object({ mailboxId: id });
export const ScanPayload = z.object({
  profileId: id,
  targetId: id,
  recipeId: z.string().nullable(),
});
export const FormPayload = z.object({
  requestId: id,
  targetId: id,
  recipeId: z.string().nullable(),
  recordUrl: WebUrl.nullable(),
});
export const ConfirmPayload = z.object({ requestId: id, url: WebUrl });
export const CanaryPayload = z.object({ recipeId: id });
export const AgentPayload = z.object({
  purpose: z.enum(["scan", "remove"]),
  profileId: id,
  targetId: id,
  requestId: z.string().nullable(),
  recordUrl: WebUrl.nullable(),
  reason: z.enum(["no_recipe", "recipe_failed"]),
  previousError: z.string().nullable(),
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

export const FormResult = z.object({
  outcome: z.enum(["submitted", "not_found", "already_removed", "awaiting_email_confirmation"]),
  confirmationText: z.string().optional(),
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

export const AgentResult = z.discriminatedUnion("purpose", [
  z.object({ purpose: z.literal("scan"), scan: ScanResult }),
  z.object({ purpose: z.literal("remove"), form: FormResult }),
]);
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

const claimedBase = {
  id,
  attempt: z.number().int().positive(),
  leaseExpiresAt: z.iso.datetime(),
  target: TargetSummary,
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
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  lastError: z.string().nullable(),
  hasScreenshot: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TaskSummary = z.infer<typeof TaskSummary>;

export const SCREENSHOT_MIME_TYPES = ["image/png", "image/jpeg"] as const;

/** Largest screenshot accepted, in bytes of the decoded image. */
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

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
  screenshot: TaskScreenshot.optional(),
});
export type TaskBlockReport = z.infer<typeof TaskBlockReport>;

export const TaskFailureReport = z.object({
  error: z.string().min(1).max(2000),
  retryable: z.boolean(),
  retryAfterMs: z
    .number()
    .int()
    .nonnegative()
    .max(24 * 60 * 60 * 1000)
    .optional(),
});
export type TaskFailureReport = z.infer<typeof TaskFailureReport>;

export const LEASE_MS = { min: 10_000, max: 60 * 60 * 1000, default: 5 * 60 * 1000 } as const;
export const LeaseMs = z.number().int().min(LEASE_MS.min).max(LEASE_MS.max);
