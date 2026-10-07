import { type KickRocksDb, recipes, scans } from "@kickrocks/db";
import {
  type RecipePurpose,
  type RequestRecord,
  needsRecord as targetNeedsRecord,
} from "@kickrocks/shared";
import { and, desc, eq } from "drizzle-orm";
import { type Clock, nowIso } from "./clock.js";
import { conflict } from "./errors.js";
import { newId } from "./ids.js";
import type { RequestsService } from "./requests.js";
import type { TargetsService } from "./targets.js";
import type { EnqueueResult, TaskQueue } from "./task-queue.js";

export interface ScanDispatch extends EnqueueResult {
  /** The scan row that tracks this run. Null only if a live task predates scan rows. */
  scanId: string | null;
}

/** Turns "this request is ready" and "scan this site" into queued work. */
export interface Dispatch {
  /**
   * Queues the work for a request that is in the `queued` status. An email request gets an
   * `email_send` task. A form request gets a `form` task with the active remove recipe, or an
   * `agent` task when there is none. Writes a `task_enqueued` event when a task is created.
   */
  dispatchRequest(request: RequestRecord): EnqueueResult;
  /**
   * Queues a scan with the active scan recipe, or an `agent` scan task when there is none, and
   * creates the `scans` row that will hold its candidates. Repeating it while a scan is live
   * returns the live one.
   */
  enqueueScan(profileId: string, targetId: string): ScanDispatch;
  /** Whether removal at this target starts from a scan that finds the person's record URL. */
  needsRecord: typeof targetNeedsRecord;
}

export interface DispatchDeps {
  db: KickRocksDb;
  clock: Clock;
  taskQueue: TaskQueue;
  requests: RequestsService;
  targets: TargetsService;
}

export function createDispatch({
  db,
  clock,
  taskQueue,
  requests,
  targets,
}: DispatchDeps): Dispatch {
  /** The newest approved recipe; a proposal or a rejected one never runs. */
  function activeRecipeId(targetId: string, purpose: RecipePurpose): string | null {
    const row = db
      .select({ id: recipes.id })
      .from(recipes)
      .where(
        and(
          eq(recipes.targetId, targetId),
          eq(recipes.purpose, purpose),
          eq(recipes.status, "active"),
        ),
      )
      .orderBy(desc(recipes.version))
      .limit(1)
      .get();
    return row?.id ?? null;
  }

  function noteEnqueued(request: RequestRecord, result: EnqueueResult): void {
    if (!result.created) return;
    requests.addEvent(request.id, {
      type: "task_enqueued",
      actor: "system",
      payload: { taskId: result.task.id, kind: result.task.kind },
    });
  }

  return {
    needsRecord: targetNeedsRecord,

    dispatchRequest(request) {
      if (request.status !== "queued") {
        throw conflict(
          "invalid_request_state",
          `Only a queued request can be dispatched, this one is ${request.status}`,
        );
      }
      const common = {
        profileId: request.profileId,
        targetId: request.targetId,
        requestId: request.id,
      };

      if (request.channel === "email") {
        const result = taskQueue.enqueue({
          kind: "email_send",
          payload: { requestId: request.id, followUp: request.sentAt !== null },
          dedupeKey: `email_send:${request.id}`,
          ...common,
        });
        noteEnqueued(request, result);
        return result;
      }

      const target = targets.summary(request.targetId);
      if (target.needsRecord && request.recordUrl === null) {
        throw conflict(
          "record_url_required",
          `${target.name} removes a specific record, so the request needs a record URL`,
        );
      }
      const recipeId = activeRecipeId(request.targetId, "remove");
      const result: EnqueueResult = recipeId
        ? taskQueue.enqueue({
            kind: "form",
            payload: {
              requestId: request.id,
              targetId: request.targetId,
              recipeId,
              recordUrl: request.recordUrl,
            },
            dedupeKey: `form:${request.id}`,
            ...common,
          })
        : taskQueue.enqueue({
            kind: "agent",
            payload: {
              purpose: "remove",
              profileId: request.profileId,
              targetId: request.targetId,
              requestId: request.id,
              recordUrl: request.recordUrl,
              reason: "no_recipe",
              previousError: null,
            },
            dedupeKey: `form:${request.id}`,
            ...common,
          });
      noteEnqueued(request, result);
      return result;
    },

    enqueueScan(profileId, targetId) {
      targets.getOrThrow(targetId);
      return db.transaction((tx) => {
        const recipeId = activeRecipeId(targetId, "scan");
        const dedupeKey = `scan:${profileId}:${targetId}`;
        const common = { profileId, targetId, dedupeKey };
        const result: EnqueueResult = recipeId
          ? taskQueue.enqueue({
              kind: "scan",
              payload: { profileId, targetId, recipeId },
              ...common,
            })
          : taskQueue.enqueue({
              kind: "agent",
              payload: {
                purpose: "scan",
                profileId,
                targetId,
                requestId: null,
                recordUrl: null,
                reason: "no_recipe",
                previousError: null,
              },
              ...common,
            });

        if (!result.created) {
          const existing = tx
            .select({ id: scans.id })
            .from(scans)
            .where(eq(scans.taskId, result.task.id))
            .get();
          return { ...result, scanId: existing?.id ?? null };
        }
        const scanId = newId();
        tx.insert(scans)
          .values({
            id: scanId,
            profileId,
            targetId,
            taskId: result.task.id,
            startedAt: nowIso(clock),
          })
          .run();
        return { ...result, scanId };
      });
    },
  };
}
