import { type KickRocksDb, type TaskSendRow, taskArtifacts, taskSends, tasks } from "@kickrocks/db";
import {
  type ApprovedSend,
  isOutgoingRequest,
  matchesApproved,
  matchesHeld,
  type OutgoingRequest,
  type RegisteredSend,
  type SendKind,
  type SendRequest,
  type SendRow,
  type SendStatus,
  type WorkerDecision,
} from "@kickrocks/shared";
import { and, asc, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { type Clock, nowIso } from "./clock.js";
import { conflict, notFound } from "./errors.js";
import { newId } from "./ids.js";

/** The reasons that make a release one that nobody approved, besides a send made in record mode. */
export const UNGUARDED_PREFIX = "unguarded:";

/** Marks where a run begins, so "this run's rows" has a definite meaning across resumes. */
export const RUN_STARTED = "run_started";

const MAX_LOG_ROWS = 2000;
const MAX_DECLINED_PER_CLAIM = 100;

type Registration =
  | {
      kind: "lookup" | "refused" | "guard_event";
      request: SendRequest;
      reason?: string | undefined;
    }
  | {
      kind: "held";
      request: OutgoingRequest;
      holdMs: number;
      screenshot?: { mime: string; data: Buffer } | undefined;
    }
  | { kind: "released"; request: OutgoingRequest };

export interface SendLogRows {
  sends: SendRow[];
  runStartedSeq: number;
}

export interface TaskSends {
  /** Begins a run of an agent task: closes what an earlier run left open and marks the start. */
  startRun(taskId: string, attempt: number): void;
  /** Ends a run: holds nobody decided become next-run approvable, and unspent approvals lapse. */
  endRun(taskId: string): void;
  register(
    taskId: string,
    workerId: string,
    attempt: number,
    items: readonly Registration[],
    holdCapMs: number,
  ): RegisteredSend[];
  /** What the worker should do with a held request now, without waiting. */
  workerDecision(taskId: string, sendId: string): WorkerDecision;
  /** A person's decision on a request held in a live run. */
  decide(taskId: string, sendId: string, decision: "send" | "dont_send"): SendRow;
  /**
   * The worker is about to let a paused request go. Writes down that the form may be out, and
   * answers only if the request is the one that was approved, live or for this run.
   */
  release(taskId: string, workerId: string, sendId: string, request: OutgoingRequest): string;
  result(
    taskId: string,
    releaseId: string,
    outcome: { status: number | null; error?: string | undefined },
  ): void;
  list(taskId: string): SendLogRows;
  /** True when this run released a request nobody approved, or used a channel the gate cannot see. */
  hasUnapprovedRelease(taskId: string): boolean;
  /** How many requests this run released. */
  releasesInRun(taskId: string): number;
  /** Whether a request of this task is waiting for a person right now. */
  hasLiveHold(taskId: string): boolean;
  /** Held requests of the latest run waiting for the person to approve them for the next run. */
  awaitingNextRun(taskId: string): SendRow[];
  approveForNextRun(taskId: string, declineSendIds: readonly string[]): SendRow[];
  /** The approvals and refusals a new run starts with. */
  gateFor(taskId: string): { approved: ApprovedSend[]; declined: OutgoingRequest[] };
  screenshot(taskId: string, sendId: string): { mime: string; data: Buffer } | null;
}

interface Deps {
  db: KickRocksDb;
  clock: Clock;
}

function toRow(row: TaskSendRow): SendRow {
  return {
    id: row.id,
    attempt: row.attempt,
    seq: row.seq,
    kind: row.kind,
    status: row.status,
    request: row.request,
    reason: row.reason,
    spendsSendId: row.spendsSendId,
    hasScreenshot: row.screenshotArtifactId !== null,
    expiresAt: row.expiresAt,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    releasedAt: row.releasedAt,
    responseStatus: row.responseStatus,
    responseError: row.responseError,
    createdAt: row.createdAt,
    resend: row.reason === "resend",
  };
}

export function createTaskSends({ db, clock }: Deps): TaskSends {
  type Tx = Parameters<Parameters<KickRocksDb["transaction"]>[0]>[0];
  type Handle = Pick<Tx, "select" | "insert" | "update">;

  function nextSeq(handle: Handle, taskId: string): number {
    const row = handle
      .select({ top: sql<number>`coalesce(max(${taskSends.seq}), 0)` })
      .from(taskSends)
      .where(eq(taskSends.taskId, taskId))
      .get();
    return (row?.top ?? 0) + 1;
  }

  function insert(
    handle: Handle,
    taskId: string,
    attempt: number,
    values: {
      kind: SendKind;
      status: SendStatus;
      request: SendRequest;
      reason?: string | null;
      spendsSendId?: string | null;
      screenshotArtifactId?: string | null;
      expiresAt?: string | null;
      decidedBy?: string | null;
      decidedAt?: string | null;
      releasedAt?: string | null;
      seq?: number;
    },
  ): TaskSendRow {
    return handle
      .insert(taskSends)
      .values({
        id: newId(),
        taskId,
        attempt,
        seq: nextSeq(handle, taskId),
        reason: null,
        spendsSendId: null,
        screenshotArtifactId: null,
        expiresAt: null,
        decidedBy: null,
        decidedAt: null,
        releasedAt: null,
        responseStatus: null,
        responseError: null,
        createdAt: nowIso(clock),
        ...values,
      })
      .returning()
      .get();
  }

  function leasedTo(handle: Handle, taskId: string, workerId: string) {
    const task = handle.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task) throw notFound(`Task ${taskId} not found`, "task_not_found");
    if (task.status !== "leased" || task.leaseOwner !== workerId) {
      throw conflict("lease_not_held", `Task ${taskId} is not leased to ${workerId}`);
    }
    return task;
  }

  function sendRow(handle: Handle, taskId: string, sendId: string): TaskSendRow {
    const row = handle
      .select()
      .from(taskSends)
      .where(and(eq(taskSends.id, sendId), eq(taskSends.taskId, taskId)))
      .get();
    if (!row) throw notFound(`Send ${sendId} not found`, "send_not_found");
    return row;
  }

  function runStartSeq(handle: Handle, taskId: string): number {
    const row = handle
      .select({ seq: taskSends.seq })
      .from(taskSends)
      .where(and(eq(taskSends.taskId, taskId), eq(taskSends.reason, RUN_STARTED)))
      .orderBy(desc(taskSends.seq))
      .limit(1)
      .get();
    return row?.seq ?? 0;
  }

  function runRows(handle: Handle, taskId: string): TaskSendRow[] {
    return handle
      .select()
      .from(taskSends)
      .where(and(eq(taskSends.taskId, taskId), gt(taskSends.seq, runStartSeq(handle, taskId))))
      .orderBy(asc(taskSends.seq))
      .all();
  }

  /** A hold nobody answered in time is left for the next run, wherever it is noticed. */
  function lapseExpired(handle: Handle, taskId: string): void {
    handle
      .update(taskSends)
      .set({ status: "awaiting_next_run" })
      .where(
        and(
          eq(taskSends.taskId, taskId),
          eq(taskSends.kind, "held"),
          eq(taskSends.status, "pending_live"),
          sql`${taskSends.expiresAt} <= ${nowIso(clock)}`,
        ),
      )
      .run();
  }

  function leaveForNextRun(handle: Handle, taskId: string): void {
    handle
      .update(taskSends)
      .set({ status: "awaiting_next_run" })
      .where(
        and(
          eq(taskSends.taskId, taskId),
          eq(taskSends.kind, "held"),
          eq(taskSends.status, "pending_live"),
        ),
      )
      .run();
  }

  return {
    startRun(taskId, attempt) {
      db.transaction((tx) => {
        leaveForNextRun(tx, taskId);
        insert(tx, taskId, attempt, {
          kind: "guard_event",
          status: "done",
          request: { note: `Run ${attempt} started` },
          reason: RUN_STARTED,
        });
      });
    },

    endRun(taskId) {
      db.transaction((tx) => {
        leaveForNextRun(tx, taskId);
        tx.update(taskSends)
          .set({ status: "unused" })
          .where(and(eq(taskSends.taskId, taskId), eq(taskSends.status, "approved_next_run")))
          .run();
      });
    },

    register(taskId, workerId, attempt, items, holdCapMs) {
      return db.transaction((tx) => {
        leasedTo(tx, taskId, workerId);
        const now = nowIso(clock);
        return items.map((item): RegisteredSend => {
          if (item.kind === "held") {
            const holdMs = Math.min(item.holdMs, holdCapMs);
            let screenshotArtifactId: string | null = null;
            if (item.screenshot) {
              screenshotArtifactId = newId();
              tx.insert(taskArtifacts)
                .values({
                  id: screenshotArtifactId,
                  taskId,
                  kind: "send_screenshot",
                  mime: item.screenshot.mime,
                  data: item.screenshot.data,
                  createdAt: now,
                })
                .run();
            }
            const row = insert(tx, taskId, attempt, {
              kind: "held",
              status: holdMs > 0 ? "pending_live" : "awaiting_next_run",
              request: item.request,
              screenshotArtifactId,
              expiresAt: holdMs > 0 ? new Date(Date.parse(now) + holdMs).toISOString() : null,
            });
            return { id: row.id, status: row.status, expiresAt: row.expiresAt };
          }
          if (item.kind === "released") {
            const row = insert(tx, taskId, attempt, {
              kind: "released",
              status: "releasing",
              request: item.request,
              decidedBy: "record",
              releasedAt: now,
            });
            tx.update(tasks).set({ mayHaveSubmitted: true }).where(eq(tasks.id, taskId)).run();
            return { id: row.id, status: row.status, expiresAt: null };
          }
          const row = insert(tx, taskId, attempt, {
            kind: item.kind,
            status: "done",
            request: item.request,
            reason: item.reason ?? null,
          });
          if (item.reason?.startsWith(UNGUARDED_PREFIX)) {
            // A channel the gate cannot see may have carried the form out, so the task is held.
            tx.update(tasks).set({ mayHaveSubmitted: true }).where(eq(tasks.id, taskId)).run();
          }
          return { id: row.id, status: row.status, expiresAt: null };
        });
      });
    },

    workerDecision(taskId, sendId) {
      return db.transaction((tx) => {
        lapseExpired(tx, taskId);
        const row = sendRow(tx, taskId, sendId);
        switch (row.status) {
          case "pending_live":
            return { status: "pending" };
          case "sent":
            return { status: "send" };
          case "declined":
            return { status: "dont_send" };
          default:
            return { status: "expired" };
        }
      });
    },

    decide(taskId, sendId, decision) {
      return db.transaction((tx) => {
        lapseExpired(tx, taskId);
        const row = sendRow(tx, taskId, sendId);
        if (row.kind !== "held" || row.status !== "pending_live") {
          throw conflict("send_not_waiting", "That request is no longer waiting for a decision");
        }
        const decided = tx
          .update(taskSends)
          .set({
            status: decision === "send" ? "sent" : "declined",
            decidedBy: "user",
            decidedAt: nowIso(clock),
          })
          .where(eq(taskSends.id, sendId))
          .returning()
          .get();
        if (!decided) throw notFound(`Send ${sendId} not found`, "send_not_found");
        return toRow(decided);
      });
    },

    release(taskId, workerId, sendId, request) {
      return db.transaction((tx) => {
        const task = leasedTo(tx, taskId, workerId);
        const held = sendRow(tx, taskId, sendId);
        const approved = held.request;
        if (held.kind !== "held" || !isOutgoingRequest(approved)) {
          throw conflict("send_mismatch", "That is not a request a person approved");
        }
        const now = nowIso(clock);
        let spendsSendId: string | null = null;
        if (held.status === "sent") {
          if (held.releasedAt !== null || !matchesHeld(request, approved)) {
            throw conflict("send_mismatch", "That is not the request the person approved");
          }
          tx.update(taskSends).set({ releasedAt: now }).where(eq(taskSends.id, held.id)).run();
        } else if (held.status === "approved_next_run") {
          if (!matchesApproved(request, approved)) {
            throw conflict(
              "send_mismatch",
              "That request differs from the one the person approved",
            );
          }
          tx.update(taskSends)
            .set({ status: "spent", releasedAt: now })
            .where(eq(taskSends.id, held.id))
            .run();
          spendsSendId = held.id;
        } else {
          throw conflict("send_mismatch", "That request was not approved");
        }
        const released = insert(tx, taskId, task.attempts, {
          kind: "released",
          status: "releasing",
          request,
          spendsSendId,
          decidedBy: held.decidedBy,
          decidedAt: held.decidedAt,
          releasedAt: now,
        });
        tx.update(tasks).set({ mayHaveSubmitted: true }).where(eq(tasks.id, taskId)).run();
        return released.id;
      });
    },

    result(taskId, releaseId, { status, error }) {
      db.transaction((tx) => {
        const row = sendRow(tx, taskId, releaseId);
        if (row.kind === "held") {
          // The page took a held request back, before or after the person decided about it.
          tx.update(taskSends)
            .set({ status: "withdrawn" })
            .where(
              and(eq(taskSends.id, releaseId), inArray(taskSends.status, ["pending_live", "sent"])),
            )
            .run();
          return;
        }
        if (row.kind !== "released") {
          throw conflict("send_mismatch", "Only a released request has a result");
        }
        tx.update(taskSends)
          .set({
            status: status === null ? "failed" : "sent",
            responseStatus: status,
            responseError: error ?? null,
          })
          .where(eq(taskSends.id, releaseId))
          .run();
      });
    },

    list(taskId) {
      return db.transaction((tx) => {
        lapseExpired(tx, taskId);
        const rows = tx
          .select()
          .from(taskSends)
          .where(eq(taskSends.taskId, taskId))
          .orderBy(asc(taskSends.seq))
          .limit(MAX_LOG_ROWS)
          .all();
        return { sends: rows.map(toRow), runStartedSeq: runStartSeq(tx, taskId) };
      });
    },

    hasUnapprovedRelease(taskId) {
      return runRows(db, taskId).some(
        (row) =>
          (row.kind === "released" && (row.decidedBy === null || row.decidedBy === "record")) ||
          (row.kind === "guard_event" && row.reason?.startsWith(UNGUARDED_PREFIX) === true),
      );
    },

    hasLiveHold(taskId) {
      const row = db
        .select({ id: taskSends.id })
        .from(taskSends)
        .where(
          and(
            eq(taskSends.taskId, taskId),
            eq(taskSends.kind, "held"),
            eq(taskSends.status, "pending_live"),
            sql`${taskSends.expiresAt} > ${nowIso(clock)}`,
          ),
        )
        .limit(1)
        .get();
      return row !== undefined;
    },

    releasesInRun(taskId) {
      return runRows(db, taskId).filter((row) => row.kind === "released").length;
    },

    awaitingNextRun(taskId) {
      return db.transaction((tx) => {
        lapseExpired(tx, taskId);
        return runRows(tx, taskId)
          .filter((row) => row.kind === "held" && row.status === "awaiting_next_run")
          .map(toRow);
      });
    },

    approveForNextRun(taskId, declineSendIds) {
      return db.transaction((tx) => {
        lapseExpired(tx, taskId);
        const rows = runRows(tx, taskId);
        const waiting = rows.filter(
          (row) => row.kind === "held" && row.status === "awaiting_next_run",
        );
        if (waiting.length === 0) {
          throw conflict("nothing_to_approve", "This run has no held request to approve");
        }
        const unknown = declineSendIds.filter((id) => !waiting.some((row) => row.id === id));
        if (unknown.length > 0) {
          throw conflict("send_not_waiting", "A request to decline is not waiting for approval");
        }
        const now = nowIso(clock);
        // A step that already went out has to go out again for the form to reach the step that
        // lapsed, so it is carried over as an approval of its own.
        const carried = rows.filter(
          (row) => row.kind === "held" && row.status === "sent" && row.releasedAt !== null,
        );
        const approved: TaskSendRow[] = [];
        // The carried steps are numbered ahead of the held ones, so the approval reads in the order
        // the form is filled in.
        const firstWaiting = waiting[0]?.seq ?? 0;
        tx.update(taskSends)
          .set({ seq: sql`${taskSends.seq} + ${carried.length}` })
          .where(and(eq(taskSends.taskId, taskId), gte(taskSends.seq, firstWaiting)))
          .run();
        let carriedSeq = firstWaiting;
        for (const row of [...carried, ...waiting]) {
          if (declineSendIds.includes(row.id)) {
            const declined = tx
              .update(taskSends)
              .set({ status: "declined", decidedBy: "user", decidedAt: now })
              .where(eq(taskSends.id, row.id))
              .returning()
              .get();
            if (declined) approved.push(declined);
            continue;
          }
          if (row.status === "sent") {
            approved.push(
              insert(tx, taskId, row.attempt, {
                kind: "held",
                status: "approved_next_run",
                request: row.request,
                reason: "resend",
                screenshotArtifactId: row.screenshotArtifactId,
                decidedBy: "user",
                decidedAt: now,
                seq: carriedSeq++,
              }),
            );
            continue;
          }
          const updated = tx
            .update(taskSends)
            .set({ status: "approved_next_run", decidedBy: "user", decidedAt: now })
            .where(eq(taskSends.id, row.id))
            .returning()
            .get();
          if (updated) approved.push(updated);
        }
        return approved.map(toRow);
      });
    },

    gateFor(taskId) {
      const rows = db
        .select()
        .from(taskSends)
        .where(
          and(
            eq(taskSends.taskId, taskId),
            inArray(taskSends.status, ["approved_next_run", "declined"]),
          ),
        )
        .orderBy(asc(taskSends.seq))
        .all();
      const approved: ApprovedSend[] = [];
      const declined: OutgoingRequest[] = [];
      for (const row of rows) {
        if (!isOutgoingRequest(row.request)) continue;
        if (row.status === "approved_next_run") {
          approved.push({ id: row.id, request: row.request, resend: row.reason === "resend" });
        } else {
          declined.push(row.request);
        }
      }
      return { approved, declined: declined.slice(-MAX_DECLINED_PER_CLAIM) };
    },

    screenshot(taskId, sendId) {
      const row = sendRow(db, taskId, sendId);
      if (row.screenshotArtifactId === null) return null;
      const artifact = db
        .select()
        .from(taskArtifacts)
        .where(eq(taskArtifacts.id, row.screenshotArtifactId))
        .get();
      return artifact ? { mime: artifact.mime, data: artifact.data } : null;
    },
  };
}
