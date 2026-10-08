import { z } from "zod";
import { GateEvidence, ModelIdentity } from "./agent-models.js";
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

/**
 * Which kind of worker is calling: the built-in one that runs recipes, or one that drives a model.
 * The server counts their runs and shows their health apart.
 */
export const WorkerClaimer = z.enum(["builtin", "model"]);
export type WorkerClaimer = z.infer<typeof WorkerClaimer>;

export const WorkerHeartbeatBody = z.object({
  workerId: WorkerId,
  version: z.string().max(50).optional(),
  busy: z.boolean(),
  currentTaskId: z.string().nullable().optional(),
  /** Kept per kind, so one kind of worker beating never makes the other look alive. */
  claimer: WorkerClaimer.default("builtin"),
  /** The model a model-backed worker drives, so the server can show it and decide what it may do alone. */
  model: ModelIdentity.optional(),
});
export type WorkerHeartbeatBody = z.infer<typeof WorkerHeartbeatBody>;

export const WorkerHeartbeatResponse = z.object({
  ok: z.literal(true),
  serverTime: z.iso.datetime(),
  /**
   * Every profile the instance still has. A worker keeps one Chrome profile per Kick Rocks
   * profile and deletes the browser data of any other, so deleting a profile or resetting the
   * instance also removes the cookies and history its visits left. A server that omits the list
   * says nothing about profiles, and a worker must then delete nothing.
   */
  profileIds: z.array(z.string()).optional(),
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
  /** A worker that drives a model says so, so its runs are counted apart from recipe runs. Agent work is gated whichever it says. */
  claimer: WorkerClaimer.default("builtin"),
  /**
   * The model this claim will drive. A claim that does not name one is treated as an unproven
   * model, and so is agent work claimed without saying `model` as the claimer, so a worker cannot
   * gain unattended work by leaving either out.
   */
  model: ModelIdentity.optional(),
});
export type WorkerClaimBody = z.infer<typeof WorkerClaimBody>;

export const WorkerClaimResponse = z.object({ task: ClaimedTask.nullable() });
export type WorkerClaimResponse = z.infer<typeof WorkerClaimResponse>;

export const TaskHeartbeatBody = z.object({
  workerId: WorkerId,
  leaseMs: LeaseMs.default(LEASE_MS.default),
  /**
   * Set once a removal run has clicked, so its form may already be submitted. The server then
   * holds the task for a person instead of retrying it if the lease is lost or the run ends
   * without an answer, because a retry would submit the form again.
   */
  mayHaveSubmitted: z.boolean().optional(),
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

/** A benchmark run's evidence that a model is safe to leave alone. */
export const GateResultBody = GateEvidence;
export type GateResultBody = z.infer<typeof GateResultBody>;

export const GateResultResponse = z.object({
  passed: z.boolean(),
  problems: z.array(z.string()),
  runs: z.number().int().nonnegative(),
});
export type GateResultResponse = z.infer<typeof GateResultResponse>;
