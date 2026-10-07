import { type KickRocksDb, type TaskRow, targets, taskArtifacts, tasks } from "@kickrocks/db";
import {
  type BlockedReason,
  type ClaimerKind,
  type FailureKind,
  LIVE_TASK_STATUSES,
  MAX_SCREENSHOT_BYTES,
  manualResultSchemaFor,
  parseTaskPayload,
  parseTaskResult,
  type RequestActor,
  resultSchemaFor,
  SCREENSHOT_MIME_TYPES,
  type TaskKind,
  type TaskPayloadMap,
  type TaskStatus,
  type TaskSummary,
  type TaskUsage,
  toTaskResult,
} from "@kickrocks/shared";
import { and, asc, desc, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import type { z } from "zod";
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

/**
 * How long a task whose lease ran out stays out of every claim. Its holder may still be running,
 * and a form that two workers submit is worse than a task that starts a few minutes late.
 */
export const DEFAULT_LAPSED_HOLDER_GRACE_MS = 5 * 60 * 1000;

export interface EnqueueInput<K extends TaskKind, S extends TaskKind = K> {
  kind: K;
  payload: TaskPayloadMap[K];
  priority?: number | undefined;
  profileId?: string | null | undefined;
  targetId?: string | null | undefined;
  requestId?: string | null | undefined;
  /** While a task with this key is queued, leased, or blocked, enqueuing it again returns that task. */
  dedupeKey?: string | null | undefined;
  /**
   * Other kinds that are the same work as `kind`. A live task of one of them holding the key is
   * returned instead of an error, because the key names the work and not the kind: a removal that
   * an agent holds is still the removal, even after a recipe has been approved. A task of any
   * other kind holding the key is a bug and still throws.
   */
  sameWork?: readonly S[] | undefined;
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
  /** Claim only a task of this profile. */
  profileId?: string | undefined;
  /** Skip tasks of these profiles, so a capped mailbox does not hold up one that has room. */
  excludeProfileIds?: readonly string[] | undefined;
  /** Who is claiming, which the route that took the call decides. Null for work the server does itself. */
  claimerKind?: ClaimerKind | undefined;
}

export interface HeartbeatInput {
  workerId: string;
  leaseMs: number;
  /** Once true it stays true for the attempt: the worker cannot take the click back. */
  mayHaveSubmitted?: boolean | undefined;
}

export interface CompleteInput {
  workerId: string;
  result: unknown;
  actor: RequestActor;
  usage?: TaskUsage | undefined;
}

export interface BlockInput {
  workerId: string;
  reason: BlockedReason;
  detail?: string | undefined;
  /** The page where the run got stuck. */
  url?: string | undefined;
  screenshot?: { mime: (typeof SCREENSHOT_MIME_TYPES)[number]; data: Buffer } | undefined;
  actor: RequestActor;
  usage?: TaskUsage | undefined;
}

export interface FailInput {
  workerId: string;
  error: string;
  /** When true and attempts remain, the task is queued again after a backoff. */
  retryable: boolean;
  /** A `recipe` failure is never retried, whatever `retryable` says. */
  kind?: FailureKind | undefined;
  step?: number | undefined;
  retryAfterMs?: number | undefined;
  actor: RequestActor;
  usage?: TaskUsage | undefined;
}

export interface ReleaseInput {
  workerId: string;
  /** Do not offer the task again before this time. */
  runAfter?: Date | undefined;
}

export interface MarkDoneInput {
  actor: RequestActor;
  /** How it ended, validated like a worker's result. For an agent task, the plain scan or form result. */
  result?: unknown;
  note?: string | undefined;
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
 *
 * Every change runs in one transaction together with the handlers it triggers (see
 * {@link TaskHandlers}), so the consequence of a task can never be lost to a crash. That makes all
 * of it synchronous, and a method called from inside a handler joins the handler's transaction.
 *
 * A lease that has expired is recovered by the next claim and by the scheduler's reaper, which
 * puts the task back in the queue and remembers who held it. That holder may still report
 * finished, blocked, or failed work until another claimer takes the task: a form submitted twice
 * is worse than a late answer. Only `heartbeat` refuses an expired lease, so a worker finds out
 * it is late. A recovered task stays out of every claim for a grace period, so the holder that is
 * still running is not joined by a second worker doing the same work.
 */
export interface TaskQueue {
  enqueue<K extends TaskKind, S extends TaskKind = K>(
    input: EnqueueInput<K, S>,
  ): EnqueueResult<K | S>;
  /**
   * Atomically leases the highest priority, oldest task that is due; null when none is. It first
   * recovers expired leases, so a claim always sees the current queue.
   */
  claim(input: ClaimInput): Task | null;
  /** Extends a lease. Refuses with `lease_expired` once it has run out. */
  heartbeat(id: string, input: HeartbeatInput): Task;
  complete(id: string, input: CompleteInput): Task;
  block(id: string, input: BlockInput): Task;
  fail(id: string, input: FailInput): Task;
  /**
   * Returns a leased task to the queue as if it had not been claimed: no event, and the attempt
   * is not counted. For a worker that is shutting down, or an email deferred by a send cap.
   */
  release(id: string, input: ReleaseInput): Task;
  /**
   * Makes queued tasks of one kind and profile due at `to` when they were waiting for no later
   * than `waitingUntil`. A task that waits out a recovered lease keeps its grace. Returns how
   * many it moved.
   */
  pullForward(input: { kind: TaskKind; profileId: string; waitingUntil: Date; to: Date }): number;
  /** Puts a blocked task back in the queue with a fresh attempt budget. */
  resume(id: string, actor?: RequestActor): Task;
  /** A person did the work by hand: closes a blocked task as done. */
  markDone(id: string, input: MarkDoneInput): Task;
  /** Idempotent. Cancels a task that is queued, leased, or blocked, or dismisses one that failed. */
  cancel(id: string, actor?: RequestActor): Task;
  /** Cancels every live task of a request. Returns the tasks it cancelled. */
  cancelForRequest(requestId: string, actor?: RequestActor): Task[];
  /** Returns expired leases to the queue, or fails the task when it has no attempts left. */
  reapExpiredLeases(): Task[];
  get(id: string): Task | null;
  getOrThrow(id: string): Task;
  /** Whether a task of the request is queued, leased, or blocked. */
  hasLiveTask(requestId: string): boolean;
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
  lapsedHolderGraceMs?: number;
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
    blockedUrl: row.blockedUrl,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt,
    mayHaveSubmitted: row.mayHaveSubmitted,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAfter: row.runAfter,
    dedupeKey: row.dedupeKey,
    lastError: row.lastError,
    failureKind: row.failureKind,
    failureStep: row.failureStep,
    finishedBy: row.finishedBy,
    claimerKind: row.claimerKind,
    usage: row.usage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as Task;
}

/** The row was just validated against `input.kind`, which TypeScript cannot see through the union. */
const asKind = <K extends TaskKind>(task: Task): Task<K> => task as Task<K>;

const addMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

/** Adds up what each attempt cost, so a task that took three tries reports all three. */
function addUsage(current: TaskUsage | null, extra: TaskUsage | undefined): TaskUsage | null {
  if (!extra) return current;
  const total: TaskUsage = { ...(current ?? {}) };
  for (const key of ["inputTokens", "outputTokens", "costUsd", "durationMs"] as const) {
    const add = extra[key];
    if (add !== undefined) total[key] = (total[key] ?? 0) + add;
  }
  return total;
}

function invalidResult(kind: TaskKind, error: z.ZodError): AppError {
  return new AppError(
    400,
    "invalid_result",
    `The result does not match what a ${kind} task reports`,
    error.issues.map((issue) => ({
      path: issue.path.filter((p): p is string | number => typeof p !== "symbol"),
      message: issue.message,
    })),
  );
}

export function createTaskQueue({
  db,
  clock,
  handlers,
  lapsedHolderGraceMs = DEFAULT_LAPSED_HOLDER_GRACE_MS,
}: TaskQueueDeps): TaskQueue {
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

  /**
   * Only a lease that ran out leaves an owner on a task that is not leased: it is queued while
   * attempts remain, failed once they are spent, and blocked when the form may have been
   * submitted. Every other way out clears the owner.
   */
  const isLapsedHolder = (row: TaskRow, workerId: string): boolean =>
    (row.status === "queued" || row.status === "failed" || row.status === "blocked") &&
    row.leaseOwner === workerId;

  /**
   * The row a finished, blocked, or failed report is about. After a lease runs out the task goes
   * back in the queue, or fails when no attempt is left, but remembers its last holder, who may
   * still report until someone else claims it, because an opt-out form that was submitted is
   * better kept than submitted again, and a real outcome beats the expiry failure.
   */
  function reportingRow(handle: Pick<Tx, "select">, id: string, workerId: string): TaskRow {
    const row = loadRow(handle, id);
    return isLapsedHolder(row, workerId) ? row : leasedRow(handle, id, workerId);
  }

  function emit(
    tx: Tx,
    name: TaskEvent["name"],
    task: Task,
    actor: RequestActor,
    extra: Pick<TaskEvent, "note"> = {},
  ): void {
    handlers.emit({ name, task, actor, ...extra }, tx);
  }

  /** Whether running this task again could submit a form a second time. */
  function mayResubmit(row: TaskRow): boolean {
    if (!row.mayHaveSubmitted) return false;
    if (row.kind === "form") return true;
    return row.kind === "agent" && parseTaskPayload("agent", row.payload).purpose === "remove";
  }

  /**
   * Parks a removal that may already have been submitted for a person, who can see the page and
   * decide, in place of the retry that would submit the form again.
   */
  function holdForPerson(
    tx: Tx,
    row: TaskRow,
    cause: { text: string; finishedBy: string | null; usage: TaskUsage | undefined },
    actor: RequestActor,
    now: string,
  ): Task {
    const updated = tx
      .update(tasks)
      .set({
        status: "blocked",
        blockedReason: "unknown",
        blockedDetail: `The form may already have been submitted, so it was not retried. The run ended with: ${cause.text}`,
        blockedUrl: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: cause.text,
        finishedBy: cause.finishedBy ?? row.finishedBy,
        usage: addUsage(row.usage, cause.usage),
        updatedAt: now,
      })
      .where(eq(tasks.id, row.id))
      .returning()
      .get();
    const task = toTask(updated);
    emit(tx, "blocked", task, actor);
    return task;
  }

  /**
   * Re-queues with a backoff while attempts remain, otherwise fails for good, and tells the
   * handlers which of the two happened. A removal that may have been submitted is held for a
   * person instead of being queued again.
   */
  function retryOrFail(
    tx: Tx,
    row: TaskRow,
    failure: {
      error: string;
      retryable: boolean;
      delayMs: number;
      kind: FailureKind;
      step: number | null;
      finishedBy: string | null;
      usage: TaskUsage | undefined;
    },
    actor: RequestActor,
    now: string,
  ): Task {
    const requeue = failure.retryable && row.attempts < row.maxAttempts;
    if (requeue && mayResubmit(row)) {
      return holdForPerson(
        tx,
        row,
        { text: failure.error, finishedBy: failure.finishedBy, usage: failure.usage },
        actor,
        now,
      );
    }
    const updated = tx
      .update(tasks)
      .set({
        status: requeue ? "queued" : "failed",
        leaseOwner: null,
        leaseExpiresAt: null,
        runAfter: requeue ? addMs(now, failure.delayMs) : row.runAfter,
        lastError: failure.error,
        failureKind: failure.kind,
        failureStep: failure.step,
        finishedBy: failure.finishedBy ?? row.finishedBy,
        usage: addUsage(row.usage, failure.usage),
        updatedAt: now,
      })
      .where(eq(tasks.id, row.id))
      .returning()
      .get();
    const task = toTask(updated);
    emit(tx, requeue ? "retrying" : "failed", task, actor);
    return task;
  }

  function expireLease(tx: Tx, row: TaskRow, now: string): Task {
    const task = mayResubmit(row)
      ? holdForPerson(
          tx,
          row,
          { text: "The lease expired", finishedBy: row.leaseOwner, usage: undefined },
          "system",
          now,
        )
      : retryOrFail(
          tx,
          row,
          {
            error: "The lease expired",
            retryable: true,
            delayMs: Math.max(retryDelayMs(row.attempts), lapsedHolderGraceMs),
            kind: "internal",
            step: null,
            finishedBy: null,
            usage: undefined,
          },
          "system",
          now,
        );
    tx.update(tasks).set({ leaseOwner: row.leaseOwner }).where(eq(tasks.id, row.id)).run();
    return { ...task, leaseOwner: row.leaseOwner };
  }

  function expiredLeases(tx: Pick<Tx, "select">, now: string): TaskRow[] {
    return tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.status, "leased"), lte(tasks.leaseExpiresAt, now)))
      .orderBy(asc(sql`rowid`))
      .all();
  }

  function cancelRow(tx: Tx, row: TaskRow, actor: RequestActor, now: string): Task {
    const task = toTask(
      tx
        .update(tasks)
        .set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
        .where(eq(tasks.id, row.id))
        .returning()
        .get(),
    );
    emit(tx, "cancelled", task, actor);
    return task;
  }

  const isLive = (status: TaskStatus) =>
    (LIVE_TASK_STATUSES as readonly TaskStatus[]).includes(status);

  return {
    enqueue<K extends TaskKind, S extends TaskKind = K>(input: EnqueueInput<K, S>) {
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
            const sameWork =
              existing.kind === input.kind ||
              (input.sameWork as readonly TaskKind[] | undefined)?.includes(existing.kind);
            if (!sameWork) {
              throw conflict(
                "dedupe_key_conflict",
                `Dedupe key ${input.dedupeKey} is held by a ${existing.kind} task`,
              );
            }
            return { task: asKind<K | S>(toTask(existing)), created: false };
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
        return { task: asKind<K | S>(toTask(row)), created: true };
      });
    },

    claim({ workerId, kinds, leaseMs, taskId, profileId, excludeProfileIds, claimerKind }) {
      if (kinds.length === 0) return null;
      const now = nowIso(clock);
      return db.transaction(
        (tx) => {
          for (const expired of expiredLeases(tx, now)) expireLease(tx, expired, now);
          const candidate = tx
            .select()
            .from(tasks)
            .where(
              and(
                eq(tasks.status, "queued"),
                inArray(tasks.kind, [...kinds]),
                or(isNull(tasks.runAfter), lte(tasks.runAfter, now)),
                taskId ? eq(tasks.id, taskId) : undefined,
                profileId ? eq(tasks.profileId, profileId) : undefined,
                excludeProfileIds && excludeProfileIds.length > 0
                  ? or(isNull(tasks.profileId), notInArray(tasks.profileId, [...excludeProfileIds]))
                  : undefined,
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
              mayHaveSubmitted: false,
              claimerKind: claimerKind ?? null,
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

    heartbeat(id, { workerId, leaseMs, mayHaveSubmitted }) {
      const now = nowIso(clock);
      return db.transaction((tx) => {
        const row = loadRow(tx, id);
        if (isLapsedHolder(row, workerId)) {
          throw conflict("lease_expired", `The lease on task ${id} ran out and was recovered`);
        }
        const current = leasedRow(tx, id, workerId);
        if (current.leaseExpiresAt !== null && current.leaseExpiresAt <= now) {
          throw conflict(
            "lease_expired",
            `The lease on task ${id} ran out at ${current.leaseExpiresAt}`,
          );
        }
        const extended = tx
          .update(tasks)
          .set({
            leaseExpiresAt: addMs(now, leaseMs),
            updatedAt: now,
            ...(mayHaveSubmitted ? { mayHaveSubmitted: true } : {}),
          })
          .where(eq(tasks.id, id))
          .returning()
          .get();
        return toTask(extended);
      });
    },

    complete(id, { workerId, result, actor, usage }) {
      const now = nowIso(clock);
      return db.transaction((tx) => {
        const row = reportingRow(tx, id, workerId);
        const parsed = resultSchemaFor(row).safeParse(result);
        if (!parsed.success) throw invalidResult(row.kind, parsed.error);
        const task = toTask(
          tx
            .update(tasks)
            .set({
              status: "done",
              result: parsed.data,
              leaseOwner: null,
              leaseExpiresAt: null,
              lastError: null,
              finishedBy: workerId,
              usage: addUsage(row.usage, usage),
              updatedAt: now,
            })
            .where(eq(tasks.id, id))
            .returning()
            .get(),
        );
        emit(tx, "completed", task, actor);
        return task;
      });
    },

    block(id, { workerId, reason, detail, url, screenshot, actor, usage }) {
      const now = nowIso(clock);
      if (screenshot) {
        if (screenshot.data.byteLength > MAX_SCREENSHOT_BYTES) {
          throw new AppError(400, "screenshot_too_large", "The screenshot is too large");
        }
        if (!SCREENSHOT_MIME_TYPES.includes(screenshot.mime)) {
          throw new AppError(400, "invalid_screenshot", "The screenshot must be a PNG or JPEG");
        }
      }
      return db.transaction((tx) => {
        const row = reportingRow(tx, id, workerId);
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
        const task = toTask(
          tx
            .update(tasks)
            .set({
              status: "blocked",
              blockedReason: reason,
              blockedDetail: detail ?? null,
              blockedUrl: url ?? null,
              leaseOwner: null,
              leaseExpiresAt: null,
              finishedBy: workerId,
              usage: addUsage(row.usage, usage),
              updatedAt: now,
            })
            .where(eq(tasks.id, id))
            .returning()
            .get(),
        );
        emit(tx, "blocked", task, actor);
        return task;
      });
    },

    fail(id, { workerId, error, retryable, kind = "internal", step, retryAfterMs, actor, usage }) {
      const now = nowIso(clock);
      return db.transaction((tx) => {
        const row = reportingRow(tx, id, workerId);
        return retryOrFail(
          tx,
          row,
          {
            error,
            // The same script would break the same way, so a recipe failure goes to an agent now.
            retryable: retryable && kind !== "recipe",
            delayMs: retryAfterMs ?? retryDelayMs(row.attempts),
            kind,
            step: step ?? null,
            finishedBy: workerId,
            usage,
          },
          actor,
          now,
        );
      });
    },

    release(id, { workerId, runAfter }) {
      const now = nowIso(clock);
      return db.transaction((tx) => {
        const row = leasedRow(tx, id, workerId);
        if (mayResubmit(row)) {
          return holdForPerson(
            tx,
            row,
            { text: "The worker handed the task back", finishedBy: workerId, usage: undefined },
            "worker",
            now,
          );
        }
        return toTask(
          tx
            .update(tasks)
            .set({
              status: "queued",
              leaseOwner: null,
              leaseExpiresAt: null,
              attempts: Math.max(row.attempts - 1, 0),
              runAfter: runAfter ? runAfter.toISOString() : null,
              updatedAt: now,
            })
            .where(eq(tasks.id, id))
            .returning()
            .get(),
        );
      });
    },

    pullForward({ kind, profileId, waitingUntil, to }) {
      return db
        .update(tasks)
        .set({ runAfter: to.toISOString(), updatedAt: nowIso(clock) })
        .where(
          and(
            eq(tasks.status, "queued"),
            eq(tasks.kind, kind),
            eq(tasks.profileId, profileId),
            isNull(tasks.leaseOwner),
            lte(tasks.runAfter, waitingUntil.toISOString()),
            sql`${tasks.runAfter} > ${to.toISOString()}`,
          ),
        )
        .run().changes;
    },

    resume(id, actor = "user") {
      const now = nowIso(clock);
      return db.transaction((tx) => {
        const row = loadRow(tx, id);
        if (row.status !== "blocked") {
          throw conflict("invalid_task_state", `Task ${id} is ${row.status}, not blocked`);
        }
        const task = toTask(
          tx
            .update(tasks)
            .set({
              status: "queued",
              blockedReason: null,
              blockedDetail: null,
              blockedUrl: null,
              leaseOwner: null,
              mayHaveSubmitted: false,
              attempts: 0,
              runAfter: null,
              updatedAt: now,
            })
            .where(eq(tasks.id, id))
            .returning()
            .get(),
        );
        emit(tx, "resumed", task, actor);
        return task;
      });
    },

    markDone(id, { actor, result, note }) {
      const now = nowIso(clock);
      return db.transaction((tx) => {
        const row = loadRow(tx, id);
        // An agent task nobody has picked up can be finished by hand: with no agent connected,
        // the person is the only one who will ever do it.
        const unclaimedAgentTask = row.status === "queued" && row.kind === "agent";
        if (row.status !== "blocked" && !unclaimedAgentTask) {
          throw conflict("invalid_task_state", `Task ${id} is ${row.status}, not blocked`);
        }
        let stored: unknown = null;
        if (result !== undefined) {
          const parsed = manualResultSchemaFor(row).safeParse(result);
          if (!parsed.success) throw invalidResult(row.kind, parsed.error);
          stored = toTaskResult(row, parsed.data);
        }
        const task = toTask(
          tx
            .update(tasks)
            .set({
              status: "done",
              result: stored,
              leaseOwner: null,
              lastError: null,
              updatedAt: now,
            })
            .where(eq(tasks.id, id))
            .returning()
            .get(),
        );
        emit(tx, "completed", task, actor, note === undefined ? {} : { note });
        return task;
      });
    },

    cancel(id, actor = "system") {
      const now = nowIso(clock);
      return db.transaction((tx) => {
        const row = loadRow(tx, id);
        if (row.status === "cancelled") return toTask(row);
        // Cancelling a failed task is how a person dismisses it from the review queue.
        if (!isLive(row.status) && row.status !== "failed") {
          throw conflict("invalid_task_state", `Task ${id} is already ${row.status}`);
        }
        return cancelRow(tx, row, actor, now);
      });
    },

    cancelForRequest(requestId, actor = "system") {
      const now = nowIso(clock);
      return db.transaction((tx) =>
        tx
          .select()
          .from(tasks)
          .where(
            and(eq(tasks.requestId, requestId), inArray(tasks.status, [...LIVE_TASK_STATUSES])),
          )
          .orderBy(asc(sql`rowid`))
          .all()
          .map((row) => cancelRow(tx, row, actor, now)),
      );
    },

    reapExpiredLeases() {
      const now = nowIso(clock);
      const expired = expiredLeases(db, now);
      // One transaction each, so a handler that throws for one task leaves the others recovered.
      return expired.map((row) => db.transaction((tx) => expireLease(tx, row, now)));
    },

    get(id) {
      const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
      return row ? toTask(row) : null;
    },

    getOrThrow(id) {
      return toTask(loadRow(db, id));
    },

    hasLiveTask(requestId) {
      return (
        db
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(eq(tasks.requestId, requestId), inArray(tasks.status, [...LIVE_TASK_STATUSES])),
          )
          .limit(1)
          .get() !== undefined
      );
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
        blockedUrl: task.blockedUrl,
        attempts: task.attempts,
        maxAttempts: task.maxAttempts,
        lastError: task.lastError,
        failureKind: task.failureKind,
        failureStep: task.failureStep,
        hasScreenshot: withScreenshot.has(task.id),
        finishedBy: task.finishedBy,
        claimerKind: task.claimerKind,
        usage: task.usage,
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
