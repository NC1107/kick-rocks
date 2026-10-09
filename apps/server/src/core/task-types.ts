import type {
  BlockedReason,
  ClaimerKind,
  FailureKind,
  RequestActor,
  TaskKind,
  TaskPayloadMap,
  TaskResultMap,
  TaskStatus,
  TaskUsage,
} from "@kickrocks/shared";

interface TaskBase {
  id: string;
  status: TaskStatus;
  /** Higher runs first. */
  priority: number;
  profileId: string | null;
  targetId: string | null;
  requestId: string | null;
  blockedReason: BlockedReason | null;
  blockedDetail: string | null;
  /** The page where a worker got stuck. */
  blockedUrl: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  /** A removal run said it has clicked, so its form may be submitted and the task is never retried. */
  mayHaveSubmitted: boolean;
  /** See `tasks.submitApproval` in the schema. */
  submitApproval: "required" | null;
  /** How many times the task has been claimed, less the times it was handed back unstarted. */
  attempts: number;
  maxAttempts: number;
  /** The task is not claimable before this time. */
  runAfter: string | null;
  dedupeKey: string | null;
  lastError: string | null;
  /** What broke in the last failure, null when it never failed. */
  failureKind: FailureKind | null;
  failureStep: number | null;
  /** The worker that last ended its lease on the task. */
  finishedBy: string | null;
  /** Who claimed it, set by the route that claimed it. Null for work the server does itself. */
  claimerKind: ClaimerKind | null;
  /** What the attempts cost, summed. */
  usage: TaskUsage | null;
  createdAt: string;
  updatedAt: string;
}

type TaskOfKind<K extends TaskKind> = TaskBase & {
  kind: K;
  payload: TaskPayloadMap[K];
  /** Null until the task completes, and null for a task a person marked done with no result. */
  result: TaskResultMap[K] | null;
};

/** A task with its payload and result typed by kind; `Task` alone is the union over every kind. */
export type Task<K extends TaskKind = TaskKind> = K extends TaskKind ? TaskOfKind<K> : never;

/**
 * What happened to a task that a handler may need to react to.
 * - `completed`: finished, by a worker's result or by a person marking it done.
 * - `blocked`: parked for a human.
 * - `failed`: failed for good, with no attempts left or not retryable.
 * - `retrying`: failed and went back in the queue after a backoff.
 * - `cancelled` and `resumed`: a person or the system took it out of the queue or put it back.
 * A task handed back with `release` is not an event, because nothing happened to the work.
 */
export type TaskEventName =
  | "completed"
  | "blocked"
  | "failed"
  | "retrying"
  | "cancelled"
  | "resumed";

/** What a registered handler is told after a task changes state. */
export interface TaskEvent<K extends TaskKind = TaskKind> {
  name: TaskEventName;
  task: Task<K>;
  /** Who caused it: the worker or agent that reported, the user who marked it done, or the system. */
  actor: RequestActor;
  /** What the person wrote when they finished a blocked task by hand. */
  note?: string;
}
