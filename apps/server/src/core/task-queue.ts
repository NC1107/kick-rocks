import { type KickRocksDb, type TaskRow, targets, taskArtifacts, tasks } from "@kickrocks/db";
import {
  type BlockedReason,
  LIVE_TASK_STATUSES,
  MAX_SCREENSHOT_BYTES,
  parseTaskPayload,
  parseTaskResult,
  type RequestActor,
  SCREENSHOT_MIME_TYPES,
  TASK_RESULT_SCHEMAS,
  type TaskKind,
  type TaskPayloadMap,
  type TaskStatus,
  type TaskSummary,
} from "@kickrocks/shared";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { type Clock, nowIso } from "./clock.js";
import { AppError, conflict, notFound } from "./errors.js";
import { newId } from "./ids.js";
import type { TaskHandlers } from "./task-handlers.js";
import type { Task, TaskEvent } from "./task-types.js";

export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Confirmation links expire and replies are time sensitive, so they go first; agent fallbacks
 * come after the work a recipe can do, and canary checks fill the gaps.
 */
export const TASK_PRIORITY: Record<TaskKind, number> = {
  confirm: 30,
  inbox_poll: 30,
  email_send: 20,
  form: 20,
  scan: 20,
  agent: 10,
  canary: 0,
};

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60 * 1000;

/** Delay before attempt number `attempts + 1`: 30s, 1m, 2m, and so on up to an hour. */
export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(attempts - 1, 0), RETRY_MAX_MS);
}

export interface EnqueueInput<K extends TaskKind> {
  kind: K;
  payload: TaskPayloadMap[K];
  priority?: number | undefined;
  profileId?: string | null | undefined;
  targetId?: string | null | undefined;
  requestId?: string | null | undefined;
  /** While a task with this key is queued, leased, or blocked, enqueuing it again returns that task. */
  dedupeKey?: string | null | undefined;
  runAfter?: Date | null | undefined;
  maxAttempts?: number | undefined;
}

export interface EnqueueResult<K extends TaskKind = TaskKind> {
  task: Task<K>;
  /** False when a live task with the same dedupe key already existed. */
  created: boolean;
}

export interface ClaimInput {
  workerId: string;
  kinds: readonly TaskKind[];
  leaseMs: number;
  /** Claim this task only, if it is queued and one of `kinds`. */
  taskId?: string | undefined;
}

export interface HeartbeatInput {
  workerId: string;
  leaseMs: number;
}

export interface CompleteInput {
  workerId: string;
  result: unknown;
  actor: RequestActor;
}

export interface BlockInput {
  workerId: string;
  reason: BlockedReason;
  detail?: string | undefined;
  screenshot?: { mime: (typeof SCREENSHOT_MIME_TYPES)[number]; data: Buffer } | undefined;
  actor: RequestActor;
}

export interface FailInput {
  workerId: string;
  error: string;
  /** When true and attempts remain, the task is queued again after a backoff. */
  retryable: boolean;
  retryAfterMs?: number | undefined;
  actor: RequestActor;
}

export interface TaskFilter {
  status?: TaskStatus | readonly TaskStatus[] | undefined;
  kinds?: readonly TaskKind[] | undefined;
  profileId?: string | undefined;
  targetId?: string | undefined;
  requestId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface TaskScreenshotData {
  mime: string;
  data: Buffer;
}

/**
 * The work queue that every process shares. Methods that change who owns a task check that the
 * caller holds the lease, so a worker that was too slow cannot overwrite the one that took over.
 * Methods that end a task are async because they wait for the registered handlers.
 */
export interface TaskQueue {
  enqueue<K extends TaskKind>(input: EnqueueInput<K>): EnqueueResult<K>;
  /** Atomically leases the highest priority, oldest task that is due; null when none is. */
  claim(input: ClaimInput): Task | null;
  heartbeat(id: string, input: HeartbeatInput): Task;
  complete(id: string, input: CompleteInput): Promise<Task>;
  block(id: string, input: BlockInput): Promise<Task>;
  fail(id: string, input: FailInput): Promise<Task>;
  /** Puts a blocked task back in the queue with a fresh attempt budget. */
  resume(id: string): Task;
  /** A person did the work by hand: closes a blocked task as done with no result. */
  markDone(id: string, actor: RequestActor): Promise<Task>;
  /** Idempotent. Cancels a task that is queued, leased, or blocked. */
  cancel(id: string): Task;
  /** Returns expired leases to the queue, or fails the task when it has no attempts left. */
  reapExpiredLeases(): Promise<Task[]>;
  get(id: string): Task | null;
  getOrThrow(id: string): Task;
  /** Newest first. */
  list(filter?: TaskFilter): Task[];
  summarize(tasks: readonly Task[]): TaskSummary[];
  screenshot(taskId: string): TaskScreenshotData | null;
  /** Deletes artifacts of tasks that finished before `cutoff`. Returns how many were removed. */
  purgeArtifacts(cutoff: Date): number;
}

export interface TaskQueueDeps {
  db: KickRocksDb;
  clock: Clock;
  handlers: TaskHandlers;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    profileId: row.profileId,
    targetId: row.targetId,
    requestId: row.requestId,
    payload: parseTaskPayload(row.kind, row.payload),
    result: row.result === null ? null : parseTaskResult(row.kind, row.result),
    blockedReason: row.blockedReason,
    blockedDetail: row.blockedDetail,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAfter: row.runAfter,
    dedupeKey: row.dedupeKey,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as Task;
}

/** The row was just validated against `input.kind`, which TypeScript cannot see through the union. */
const asKind = <K extends TaskKind>(task: Task): Task<K> => task as Task<K>;

const addMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

export function createTaskQueue({ db, clock, handlers }: TaskQueueDeps): TaskQueue {
  type Tx = Parameters<Parameters<KickRocksDb["transaction"]>[0]>[0];

  function loadRow(handle: Pick<Tx, "select">, id: string): TaskRow {
    const row = handle.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!row) throw notFound(`Task ${id} not found`, "task_not_found");
    return row;
  }

  function leasedRow(handle: Pick<Tx, "select">, id: string, workerId: string): TaskRow {
    const row = loadRow(handle, id);
    if (row.status !== "leased" || row.leaseOwner !== workerId) {
      throw conflict("lease_not_held", `Task ${id} is not leased to ${workerId}`);
    }
    return row;
  }

  function emit(name: TaskEvent["name"], task: Task, actor: RequestActor): Promise<void> {
    return handlers.emit({ name, task, actor });
  }

  /** Re-queues with a backoff while attempts remain, otherwise fails for good. */
  function retryOrFail(
    tx: Tx,
    row: TaskRow,
    error: string,
    retryable: boolean,
    delayMs: number,
    now: string,
  ): TaskRow {
    const requeue = retryable && row.attempts < row.maxAttempts;
    return tx
      .update(tasks)
      .set({
        status: requeue ? "queued" : "failed",
        leaseOwner: null,
        leaseExpiresAt: null,
        runAfter: requeue ? addMs(now, delayMs) : row.runAfter,
        lastError: error,
        updatedAt: now,
      })
      .where(eq(tasks.id, row.id))
      .returning()
      .get();
  }

  return {
    enqueue<K extends TaskKind>(input: EnqueueInput<K>) {
      const payload = parseTaskPayload(input.kind, input.payload);
      const now = nowIso(clock);
      return db.transaction((tx) => {
        if (input.dedupeKey) {
          const existing = tx
            .select()
            .from(tasks)
            .where(
              and(
                eq(tasks.dedupeKey, input.dedupeKey),
                inArray(tasks.status, [...LIVE_TASK_STATUSES]),
              ),
            )
            .get();
          if (existing) {
            if (existing.kind !== input.kind) {
              throw conflict(
                "dedupe_key_conflict",
                `Dedupe key ${input.dedupeKey} is held by a ${existing.kind} task`,
              );
            }
            return { task: asKind<K>(toTask(existing)), created: false };
          }
        }
        const row = tx
          .insert(tasks)
          .values({
            id: newId(),
            kind: input.kind,
            status: "queued",
            priority: input.priority ?? TASK_PRIORITY[input.kind],
            profileId: input.profileId ?? null,
            targetId: input.targetId ?? null,
            requestId: input.requestId ?? null,
            payload,
            maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
            runAfter: input.runAfter ? input.runAfter.toISOString() : null,
            dedupeKey: input.dedupeKey ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        return { task: asKind<K>(toTask(row)), created: true };
      });
    },

    claim({ workerId, kinds, leaseMs, taskId }) {
      if (kinds.length === 0) return null;
      const now = nowIso(clock);
      return db.transaction(
        (tx) => {
          const candidate = tx
            .select()
            .from(tasks)
            .where(
              and(
                eq(tasks.status, "queued"),
                inArray(tasks.kind, [...kinds]),
                or(isNull(tasks.runAfter), lte(tasks.runAfter, now)),
                taskId ? eq(tasks.id, taskId) : undefined,
              ),
            )
            .orderBy(desc(tasks.priority), asc(tasks.createdAt), asc(sql`rowid`))
            .limit(1)
            .get();
          if (!candidate) return null;
          const row = tx
            .update(tasks)
            .set({
              status: "leased",
              leaseOwner: workerId,
              leaseExpiresAt: addMs(now, leaseMs),
              attempts: candidate.attempts + 1,
              updatedAt: now,
            })
            .where(eq(tasks.id, candidate.id))
            .returning()
            .get();
          return toTask(row);
        },
        { behavior: "immediate" },
      );
    },

    heartbeat(id, { workerId, leaseMs }) {
      const now = nowIso(clock);
      return db.transaction((tx) => {
        leasedRow(tx, id, workerId);
        const row = tx
          .update(tasks)
          .set({ leaseExpiresAt: addMs(now, leaseMs), updatedAt: now })
          .where(eq(tasks.id, id))
          .returning()
          .get();
        return toTask(row);
      });
    },

    async complete(id, { workerId, result, actor }) {
      const now = nowIso(clock);
      const task = db.transaction((tx) => {
        const row = leasedRow(tx, id, workerId);
        const parsed = TASK_RESULT_SCHEMAS[row.kind].safeParse(result);
        if (!parsed.success) {
          throw new AppError(
            400,
            "invalid_result",
            `The result does not match what a ${row.kind} task reports`,
            parsed.error.issues.map((issue) => ({
              path: issue.path.filter((p): p is string | number => typeof p !== "symbol"),
              message: issue.message,
            })),
          );
        }
        return toTask(
          tx
            .update(tasks)
            .set({
              status: "done",
              result: parsed.data,
              leaseOwner: null,
              leaseExpiresAt: null,
              lastError: null,
              updatedAt: now,
            })
            .where(eq(tasks.id, id))
            .returning()
            .get(),
        );
      });
      await emit("completed", task, actor);
      return task;
    },

    async block(id, { workerId, reason, detail, screenshot, actor }) {
      const now = nowIso(clock);
      if (screenshot) {
        if (screenshot.data.byteLength > MAX_SCREENSHOT_BYTES) {
          throw new AppError(400, "screenshot_too_large", "The screenshot is too large");
        }
        if (!SCREENSHOT_MIME_TYPES.includes(screenshot.mime)) {
          throw new AppError(400, "invalid_screenshot", "The screenshot must be a PNG or JPEG");
        }
      }
      const task = db.transaction((tx) => {
        leasedRow(tx, id, workerId);
        if (screenshot) {
          tx.insert(taskArtifacts)
            .values({
              id: newId(),
              taskId: id,
              kind: "screenshot",
              mime: screenshot.mime,
              data: screenshot.data,
              createdAt: now,
            })
            .run();
        }
        return toTask(
          tx
            .update(tasks)
            .set({
              status: "blocked",
              blockedReason: reason,
              blockedDetail: detail ?? null,
              leaseOwner: null,
              leaseExpiresAt: null,
              updatedAt: now,
            })
            .where(eq(tasks.id, id))
            .returning()
            .get(),
        );
      });
      await emit("blocked", task, actor);
      return task;
    },

    async fail(id, { workerId, error, retryable, retryAfterMs, actor }) {
      const now = nowIso(clock);
      const task = db.transaction((tx) => {
        const row = leasedRow(tx, id, workerId);
        return toTask(
          retryOrFail(tx, row, error, retryable, retryAfterMs ?? retryDelayMs(row.attempts), now),
        );
      });
      if (task.status === "failed") await emit("failed", task, actor);
      return task;
    },

    resume(id) {
      const now = nowIso(clock);
      return db.transaction((tx) => {
        const row = loadRow(tx, id);
        if (row.status !== "blocked") {
          throw conflict("invalid_task_state", `Task ${id} is ${row.status}, not blocked`);
        }
        return toTask(
          tx
            .update(tasks)
            .set({
              status: "queued",
              blockedReason: null,
              blockedDetail: null,
              attempts: 0,
              runAfter: null,
              updatedAt: now,
            })
            .where(eq(tasks.id, id))
            .returning()
            .get(),
        );
      });
    },

    async markDone(id, actor) {
      const now = nowIso(clock);
      const task = db.transaction((tx) => {
        const row = loadRow(tx, id);
        if (row.status !== "blocked") {
          throw conflict("invalid_task_state", `Task ${id} is ${row.status}, not blocked`);
        }
        return toTask(
          tx
            .update(tasks)
            .set({ status: "done", lastError: null, updatedAt: now })
            .where(eq(tasks.id, id))
            .returning()
            .get(),
        );
      });
      await emit("completed", task, actor);
      return task;
    },

    cancel(id) {
      const now = nowIso(clock);
      return db.transaction((tx) => {
        const row = loadRow(tx, id);
        if (row.status === "cancelled") return toTask(row);
        if (!(LIVE_TASK_STATUSES as readonly TaskStatus[]).includes(row.status)) {
          throw conflict("invalid_task_state", `Task ${id} is already ${row.status}`);
        }
        return toTask(
          tx
            .update(tasks)
            .set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
            .where(eq(tasks.id, id))
            .returning()
            .get(),
        );
      });
    },

    async reapExpiredLeases() {
      const now = nowIso(clock);
      const reaped = db.transaction((tx) =>
        tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.status, "leased"), lte(tasks.leaseExpiresAt, now)))
          .orderBy(asc(sql`rowid`))
          .all()
          .map((row) =>
            toTask(
              retryOrFail(tx, row, "The lease expired", true, retryDelayMs(row.attempts), now),
            ),
          ),
      );
      for (const task of reaped) if (task.status === "failed") await emit("failed", task, "system");
      return reaped;
    },

    get(id) {
      const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
      return row ? toTask(row) : null;
    },

    getOrThrow(id) {
      return toTask(loadRow(db, id));
    },

    list(filter = {}) {
      const statuses =
        filter.status === undefined
          ? undefined
          : typeof filter.status === "string"
            ? [filter.status]
            : [...filter.status];
      return (
        db
          .select()
          .from(tasks)
          .where(
            and(
              statuses ? inArray(tasks.status, statuses) : undefined,
              filter.kinds ? inArray(tasks.kind, [...filter.kinds]) : undefined,
              filter.profileId ? eq(tasks.profileId, filter.profileId) : undefined,
              filter.targetId ? eq(tasks.targetId, filter.targetId) : undefined,
              filter.requestId ? eq(tasks.requestId, filter.requestId) : undefined,
            ),
          )
          .orderBy(desc(tasks.createdAt), desc(sql`rowid`))
          // SQLite reads a negative limit as "no limit".
          .limit(filter.limit ?? -1)
          .offset(filter.offset ?? 0)
          .all()
          .map(toTask)
      );
    },

    summarize(list) {
      if (list.length === 0) return [];
      const ids = list.map((task) => task.id);
      const targetIds = [
        ...new Set(list.flatMap((task) => (task.targetId ? [task.targetId] : []))),
      ];
      const names = new Map(
        targetIds.length === 0
          ? []
          : db
              .select({ id: targets.id, name: targets.name })
              .from(targets)
              .where(inArray(targets.id, targetIds))
              .all()
              .map((row) => [row.id, row.name]),
      );
      const withScreenshot = new Set(
        db
          .selectDistinct({ taskId: taskArtifacts.taskId })
          .from(taskArtifacts)
          .where(and(inArray(taskArtifacts.taskId, ids), eq(taskArtifacts.kind, "screenshot")))
          .all()
          .map((row) => row.taskId),
      );
      return list.map((task) => ({
        id: task.id,
        kind: task.kind,
        status: task.status,
        priority: task.priority,
        profileId: task.profileId,
        targetId: task.targetId,
        targetName: task.targetId ? (names.get(task.targetId) ?? null) : null,
        requestId: task.requestId,
        blockedReason: task.blockedReason,
        blockedDetail: task.blockedDetail,
        attempts: task.attempts,
        maxAttempts: task.maxAttempts,
        lastError: task.lastError,
        hasScreenshot: withScreenshot.has(task.id),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      }));
    },

    screenshot(taskId) {
      const row = db
        .select()
        .from(taskArtifacts)
        .where(and(eq(taskArtifacts.taskId, taskId), eq(taskArtifacts.kind, "screenshot")))
        .orderBy(desc(taskArtifacts.createdAt), desc(sql`rowid`))
        .limit(1)
        .get();
      return row ? { mime: row.mime, data: row.data } : null;
    },

    purgeArtifacts(cutoff) {
      const finished = db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            inArray(tasks.status, ["done", "failed", "cancelled"]),
            lte(tasks.updatedAt, cutoff.toISOString()),
          ),
        );
      return db.delete(taskArtifacts).where(inArray(taskArtifacts.taskId, finished)).run().changes;
    },
  };
}
