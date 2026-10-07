import { z } from "zod";
import {
  BrowserTaskKind,
  ClaimedTask,
  LEASE_MS,
  LeaseMs,
  TaskBlockReport,
  TaskFailureReport,
  TaskSummary,
} from "./tasks.js";

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
  /** Kinds this worker can run; defaults to every browser kind. */
  kinds: z.array(BrowserTaskKind).min(1).optional(),
  leaseMs: LeaseMs.default(LEASE_MS.default),
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

/** The result is validated against the schema for the task's kind, which the client cannot choose. */
export const TaskCompleteBody = z.object({ workerId: WorkerId, result: z.unknown() });
export type TaskCompleteBody = z.infer<typeof TaskCompleteBody>;

export const TaskBlockBody = TaskBlockReport.extend({ workerId: WorkerId });
export type TaskBlockBody = z.infer<typeof TaskBlockBody>;

export const TaskFailBody = TaskFailureReport.extend({ workerId: WorkerId });
export type TaskFailBody = z.infer<typeof TaskFailBody>;

export const TaskTransitionResponse = z.object({ task: TaskSummary });
export type TaskTransitionResponse = z.infer<typeof TaskTransitionResponse>;
