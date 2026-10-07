import type {
  BlockedReason,
  RequestActor,
  TaskKind,
  TaskPayloadMap,
  TaskResultMap,
  TaskStatus,
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
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  /** How many times the task has been claimed. */
  attempts: number;
  maxAttempts: number;
  /** The task is not claimable before this time. */
  runAfter: string | null;
  dedupeKey: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

type TaskOfKind<K extends TaskKind> = TaskBase & {
  kind: K;
  payload: TaskPayloadMap[K];
  /** Null until the task completes, and null for a task a person marked done by hand. */
  result: TaskResultMap[K] | null;
};

/** A task with its payload and result typed by kind; `Task` alone is the union over every kind. */
export type Task<K extends TaskKind = TaskKind> = K extends TaskKind ? TaskOfKind<K> : never;

export type TaskEventName = "completed" | "blocked" | "failed";

/** What a registered handler is told after a task changes state. */
export interface TaskEvent<K extends TaskKind = TaskKind> {
  name: TaskEventName;
  task: Task<K>;
  /** Who caused it: the worker or agent that reported, the user who marked it done, or the system. */
  actor: RequestActor;
}
