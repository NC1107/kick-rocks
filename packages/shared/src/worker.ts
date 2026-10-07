import { z } from "zod";
import {
  BrowserTaskKind,
  ClaimedTask,
  LEASE_MS,
  LeaseMs,
  TaskBlockReport,
  TaskFailureReport,
  TaskSummary,
  TaskUsage,
} from "./tasks.js";

/**
 * What the built-in worker claims when it does not say. It runs recipes, so it takes the kinds a
 * recipe or a fixed routine can do and leaves `agent` tasks to a client that has a model; claiming
 * one it cannot run would only burn its attempts.
 */
export const WORKER_DEFAULT_KINDS = [
  "scan",
  "form",
  "confirm",
  "canary",
] as const satisfies readonly BrowserTaskKind[];

/**
 * What an MCP client claims when it does not say. Scan and form tasks carry instructions that say
 * "run recipe X", which an agent cannot do, so by default it takes only the work meant for it. It
 * can still ask for other kinds, or claim a specific task by id.
 */
export const AGENT_DEFAULT_KINDS = ["agent"] as const satisfies readonly BrowserTaskKind[];

/** Header carrying `Bearer <token>` on every worker request. */
export const WORKER_AUTH_HEADER = "authorization";

const WorkerId = z.string().min(1).max(100);

export const WorkerHeartbeatBody = z.object({
  workerId: WorkerId,
  version: z.string().max(50).optional(),
  busy: z.boolean(),
  currentTaskId: z.string().nullable().optional(),
});
export type WorkerHeartbeatBody = z.infer<typeof WorkerHeartbeatBody>;

export const WorkerHeartbeatResponse = z.object({
  ok: z.literal(true),
  serverTime: z.iso.datetime(),
});
export type WorkerHeartbeatResponse = z.infer<typeof WorkerHeartbeatResponse>;

export const WorkerClaimBody = z.object({
  workerId: WorkerId,
  /** Kinds this worker can run; defaults to {@link WORKER_DEFAULT_KINDS}. */
  kinds: z
    .array(BrowserTaskKind)
    .min(1)
    .default(() => [...WORKER_DEFAULT_KINDS]),
  leaseMs: LeaseMs.default(LEASE_MS.default),
  /** A worker that drives a model says so, so its runs are counted apart from recipe runs. */
  claimer: z.enum(["builtin", "model"]).default("builtin"),
});
export type WorkerClaimBody = z.infer<typeof WorkerClaimBody>;

export const WorkerClaimResponse = z.object({ task: ClaimedTask.nullable() });
export type WorkerClaimResponse = z.infer<typeof WorkerClaimResponse>;

export const TaskHeartbeatBody = z.object({
  workerId: WorkerId,
  leaseMs: LeaseMs.default(LEASE_MS.default),
});
export type TaskHeartbeatBody = z.infer<typeof TaskHeartbeatBody>;

export const TaskHeartbeatResponse = z.object({ leaseExpiresAt: z.iso.datetime() });
export type TaskHeartbeatResponse = z.infer<typeof TaskHeartbeatResponse>;

/**
 * The result is validated against the schema for the task's kind, and for an agent task its
 * purpose, which the client cannot choose.
 */
export const TaskCompleteBody = z.object({
  workerId: WorkerId,
  result: z.unknown(),
  usage: TaskUsage.optional(),
});
export type TaskCompleteBody = z.infer<typeof TaskCompleteBody>;

/** Hands a task back unfinished, such as when a worker shuts down, without costing it an attempt. */
export const TaskReleaseBody = z.object({
  workerId: WorkerId,
  /** Do not offer the task again for this long. */
  retryAfterMs: z
    .number()
    .int()
    .nonnegative()
    .max(24 * 60 * 60 * 1000)
    .optional(),
});
export type TaskReleaseBody = z.infer<typeof TaskReleaseBody>;

export const TaskBlockBody = TaskBlockReport.extend({ workerId: WorkerId });
export type TaskBlockBody = z.infer<typeof TaskBlockBody>;

export const TaskFailBody = TaskFailureReport.extend({ workerId: WorkerId });
export type TaskFailBody = z.infer<typeof TaskFailBody>;

export const TaskTransitionResponse = z.object({ task: TaskSummary });
export type TaskTransitionResponse = z.infer<typeof TaskTransitionResponse>;
