import { createHash } from "node:crypto";
import { type KickRocksDb, mailboxes, recipes, scans } from "@kickrocks/db";
import {
  type AgentReason,
  type BlockedReason,
  type EmailKind,
  type ProfileField,
  type RecipePurpose,
  type RequestActor,
  type ScanVariant,
  needsRecord as targetNeedsRecord,
} from "@kickrocks/shared";
import { and, desc, eq } from "drizzle-orm";
import { type Clock, nowIso } from "./clock.js";
import { conflict, notFound } from "./errors.js";
import { loadIdentities } from "./identities.js";
import { newId } from "./ids.js";
import type { RequestsService } from "./requests.js";
import { requireProfile } from "./require-profile.js";
import type { TargetsService } from "./targets.js";
import type { EnqueueResult, TaskQueue } from "./task-queue.js";
import type { Task } from "./task-types.js";

export interface ScanDispatch extends EnqueueResult {
  /** The scan row that tracks this run. Null only if a live task predates scan rows. */
  scanId: string | null;
}

export interface DispatchOptions {
  /** What the email is for. Set by whoever re-queued the request, never inferred. Defaults to `initial`. */
  kind?: EmailKind | undefined;
  /** For a verification reply, the identifiers the person approved. */
  fields?: readonly ProfileField[] | undefined;
  /** For a verification reply, the Message-ID of the broker's message it answers. */
  inReplyTo?: string | null | undefined;
}

export interface FallbackReason {
  reason: AgentReason;
  /** What went wrong, shown to the agent as context and never as instructions. */
  error: string | null;
  blockedReason?: BlockedReason | null | undefined;
}

/**
 * Turns "this request is ready", "scan this site", and the other things that have to be queued
 * into tasks with one agreed dedupe key each, so no two modules disagree about what counts as the
 * same work. The key names the work, not the kind of task doing it.
 */
export interface Dispatch {
  /**
   * Queues the work for a request in the `queued` status, read from the database rather than
   * trusted from the caller. An email request gets an `email_send` task of the given kind. A form
   * request gets a `form` task with the newest active remove recipe that is not broken, or an
   * `agent` task when there is none (reason `no_recipe`, or `recipe_failed` when every recipe is
   * broken). Writes a `task_enqueued` event when a task is created.
   */
  dispatchRequest(requestId: string, options?: DispatchOptions): EnqueueResult;
  /**
   * Queues a scan, with the same recipe rules, and creates the `scans` row that will hold its
   * candidates. `variant` searches under a past name or address. Repeating it while a scan for the
   * same profile, target, and variant is live returns the live one.
   */
  enqueueScan(profileId: string, targetId: string, variant?: ScanVariant | null): ScanDispatch;
  /**
   * Hands the work of a scan or form task to an agent, after a recipe failed or no recipe can run.
   * In one transaction it cancels the task if it is still live, enqueues an agent task under the
   * same dedupe key, and repoints the scan row at the new task so its candidates are not orphaned.
   */
  fallbackToAgent(task: Task<"scan" | "form" | "agent">, why: FallbackReason): EnqueueResult;
  /**
   * Takes a blocked scan, form, or agent task away from the built-in worker and gives it to an
   * agent, which a person asks for from the review page and an MCP client asks for by claiming a
   * blocked task. The new task says which human check stopped the earlier run.
   */
  handToAgent(taskId: string, actor: RequestActor): EnqueueResult;
  /** A confirmation link a browser has to open, deduplicated per request and link. */
  enqueueConfirm(requestId: string, url: string): EnqueueResult;
  /** A canary health check for a recipe, one at a time. */
  enqueueCanary(recipeId: string): EnqueueResult;
  /** An inbox poll for a mailbox, one at a time, whoever asks. */
  enqueueInboxPoll(mailboxId: string): EnqueueResult;
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

const BROKEN_RECIPE_ERROR = "The recipe is marked broken after repeated failures";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function sameSend(
  a: { kind: string; fields: readonly string[]; inReplyTo: string | null },
  b: { kind: string; fields: readonly string[]; inReplyTo: string | null },
): boolean {
  return (
    a.kind === b.kind &&
    a.inReplyTo === b.inReplyTo &&
    [...a.fields].sort().join(",") === [...b.fields].sort().join(",")
  );
}

export function createDispatch({
  db,
  clock,
  taskQueue,
  requests,
  targets,
}: DispatchDeps): Dispatch {
  /**
   * The newest approved recipe that is not broken. When every approved recipe is broken, says so,
   * so the work goes to an agent for the right reason instead of failing on a recipe that is known
   * not to work. A proposal or a rejected recipe never runs.
   */
  function pickRecipe(
    targetId: string,
    purpose: RecipePurpose,
  ): { recipeId: string | null; allBroken: boolean } {
    const rows = db
      .select({ id: recipes.id, health: recipes.health })
      .from(recipes)
      .where(
        and(
          eq(recipes.targetId, targetId),
          eq(recipes.purpose, purpose),
          eq(recipes.status, "active"),
        ),
      )
      .orderBy(desc(recipes.version))
      .all();
    const usable = rows.find((row) => row.health !== "broken");
    return { recipeId: usable?.id ?? null, allBroken: !usable && rows.length > 0 };
  }

  function noteEnqueued(requestId: string | null, result: EnqueueResult): void {
    if (!result.created || requestId === null) return;
    requests.addEvent(requestId, {
      type: "task_enqueued",
      actor: "system",
      payload: { taskId: result.task.id, kind: result.task.kind },
    });
  }

  function liveTarget(targetId: string) {
    const row = targets.getOrThrow(targetId);
    if (row.retired) {
      throw conflict(
        "target_retired",
        `${row.name} is no longer in the dataset, so nothing new can be sent to it`,
      );
    }
    return { row, summary: targets.toSummary(row) };
  }

  function mailboxOf(profileId: string) {
    return db.select().from(mailboxes).where(eq(mailboxes.profileId, profileId)).get() ?? null;
  }

  function requireIdentities(profileId: string, variant: ScanVariant | null): void {
    if (!variant) return;
    const identities = loadIdentities(db, profileId);
    const has = (id: string | null, kinds: readonly string[]) =>
      id === null || identities.some((i) => i.id === id && kinds.includes(i.kind));
    if (!has(variant.nameId, ["name", "alias"]) || !has(variant.addressId, ["address"])) {
      throw notFound(
        "The name or address to search under is not one of this profile's",
        "identity_not_found",
      );
    }
  }

  /** Cancels what is live, then queues the agent task under the key the old one held. */
  function toAgent(
    task: Task<"scan" | "form" | "agent">,
    why: FallbackReason,
    actor: RequestActor,
  ): EnqueueResult {
    const { dedupeKey, profileId } = task;
    if (dedupeKey === null || profileId === null) {
      throw conflict(
        "task_not_replaceable",
        `Task ${task.id} has no dedupe key or profile to carry over`,
      );
    }
    return db.transaction((tx) => {
      if (task.status === "queued" || task.status === "leased" || task.status === "blocked") {
        taskQueue.cancel(task.id, actor);
      }
      const common = {
        profileId,
        targetId: task.targetId,
        requestId: task.requestId,
        dedupeKey,
        sameWork: ["scan", "form"] as const,
      };
      const reasons = {
        reason: why.reason,
        previousError: why.error,
        blockedReason: why.blockedReason ?? null,
      };
      const result =
        task.kind === "scan"
          ? taskQueue.enqueue({
              kind: "agent",
              payload: {
                purpose: "scan",
                profileId: task.payload.profileId,
                targetId: task.payload.targetId,
                requestId: null,
                recordUrl: null,
                variant: task.payload.variant,
                ...reasons,
              },
              ...common,
            })
          : task.kind === "form"
            ? taskQueue.enqueue({
                kind: "agent",
                payload: {
                  purpose: "remove",
                  profileId,
                  targetId: task.payload.targetId,
                  requestId: task.payload.requestId,
                  recordUrl: task.payload.recordUrl,
                  variant: null,
                  ...reasons,
                },
                ...common,
              })
            : taskQueue.enqueue({
                kind: "agent",
                payload: { ...task.payload, ...reasons },
                ...common,
              });
      if (result.created && task.kind !== "form") {
        tx.update(scans).set({ taskId: result.task.id }).where(eq(scans.taskId, task.id)).run();
      }
      noteEnqueued(task.requestId, result);
      return result;
    });
  }

  return {
    needsRecord: targetNeedsRecord,

    dispatchRequest(requestId, options = {}) {
      return db.transaction(() => {
        const request = requests.getOrThrow(requestId);
        if (request.status !== "queued") {
          throw conflict(
            "invalid_request_state",
            `Only a queued request can be dispatched, this one is ${request.status}`,
          );
        }
        const { row: targetRow, summary: target } = liveTarget(request.targetId);
        const mailbox = request.mailboxId
          ? { id: request.mailboxId }
          : mailboxOf(request.profileId);
        const common = {
          profileId: request.profileId,
          targetId: request.targetId,
          requestId: request.id,
        };

        if (request.channel === "email") {
          const kind = options.kind ?? "initial";
          const fields = [...(options.fields ?? [])];
          if ((kind === "verification_reply") !== fields.length > 0) {
            throw conflict(
              "verification_fields_required",
              "A verification reply sends the fields the person approved, and no other email does",
            );
          }
          if (!mailbox) {
            throw conflict("mailbox_required", "Connect a mailbox before sending an email request");
          }
          if (!targetRow.privacyEmail) {
            throw conflict("no_email_address", `${target.name} has no email address to send to`);
          }
          const payload = {
            requestId: request.id,
            kind,
            fields,
            inReplyTo: options.inReplyTo ?? null,
          };
          // A send still waiting on the cap or the gap shares this request's dedupe key, so
          // without this the person's approved reply would be swallowed by an older, different mail.
          for (const waiting of taskQueue.list({
            requestId: request.id,
            kinds: ["email_send"],
            status: "queued",
          })) {
            if (!sameSend(waiting.payload as typeof payload, payload)) {
              taskQueue.cancel(waiting.id, "system");
            }
          }
          const result = taskQueue.enqueue({
            kind: "email_send",
            payload,
            dedupeKey: `email_send:${request.id}`,
            ...common,
          });
          noteEnqueued(request.id, result);
          return result;
        }

        if (target.needsRecord && request.recordUrl === null) {
          throw conflict(
            "record_url_required",
            `${target.name} removes a specific record, so the request needs a record URL`,
          );
        }
        const { recipeId, allBroken } = pickRecipe(request.targetId, "remove");
        const declaresEmail = recipeId
          ? (
              db
                .select({ definition: recipes.definition })
                .from(recipes)
                .where(eq(recipes.id, recipeId))
                .get()?.definition.fields ?? []
            ).includes("email")
          : false;
        if (!mailbox && (declaresEmail || target.requirements.includes("email_confirmation"))) {
          throw conflict(
            "mailbox_required",
            `${target.name} confirms by email, and the form is filled in with the mailbox address, so connect a mailbox first`,
          );
        }
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
              sameWork: ["agent"],
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
                variant: null,
                reason: allBroken ? "recipe_failed" : "no_recipe",
                previousError: allBroken ? BROKEN_RECIPE_ERROR : null,
                blockedReason: null,
              },
              dedupeKey: `form:${request.id}`,
              sameWork: ["form"],
              ...common,
            });
        noteEnqueued(request.id, result);
        return result;
      });
    },

    enqueueScan(profileId, targetId, variant = null) {
      requireProfile(db, profileId);
      liveTarget(targetId);
      requireIdentities(profileId, variant);
      return db.transaction((tx) => {
        const { recipeId, allBroken } = pickRecipe(targetId, "scan");
        const dedupeKey = variant
          ? `scan:${profileId}:${targetId}:${variant.nameId ?? ""}:${variant.addressId ?? ""}`
          : `scan:${profileId}:${targetId}`;
        const common = { profileId, targetId, dedupeKey };
        const result: EnqueueResult = recipeId
          ? taskQueue.enqueue({
              kind: "scan",
              payload: { profileId, targetId, recipeId, variant },
              sameWork: ["agent"],
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
                variant,
                reason: allBroken ? "recipe_failed" : "no_recipe",
                previousError: allBroken ? BROKEN_RECIPE_ERROR : null,
                blockedReason: null,
              },
              sameWork: ["scan"],
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

    fallbackToAgent(task, why) {
      return toAgent(task, why, "system");
    },

    handToAgent(taskId, actor) {
      return db.transaction(() => {
        const task = taskQueue.getOrThrow(taskId);
        if (task.status !== "blocked") {
          throw conflict("invalid_task_state", `Task ${taskId} is ${task.status}, not blocked`);
        }
        if (task.kind !== "scan" && task.kind !== "form" && task.kind !== "agent") {
          throw conflict("not_handoffable", `A ${task.kind} task cannot be handed to an agent`);
        }
        return toAgent(
          task as Task<"scan" | "form" | "agent">,
          {
            reason: "blocked",
            error: task.blockedDetail ?? task.lastError,
            blockedReason: task.blockedReason,
          },
          actor,
        );
      });
    },

    enqueueConfirm(requestId, url) {
      const request = requests.getOrThrow(requestId);
      const result = taskQueue.enqueue({
        kind: "confirm",
        payload: { requestId, url },
        profileId: request.profileId,
        targetId: request.targetId,
        requestId,
        dedupeKey: `confirm:${requestId}:${sha256(url)}`,
      });
      noteEnqueued(requestId, result);
      return result;
    },

    enqueueCanary(recipeId) {
      const recipe = db
        .select({ targetId: recipes.targetId })
        .from(recipes)
        .where(eq(recipes.id, recipeId))
        .get();
      if (!recipe) throw notFound(`Recipe ${recipeId} not found`, "recipe_not_found");
      return taskQueue.enqueue({
        kind: "canary",
        payload: { recipeId },
        targetId: recipe.targetId,
        dedupeKey: `canary:${recipeId}`,
      });
    },

    enqueueInboxPoll(mailboxId) {
      const mailbox = db
        .select({ profileId: mailboxes.profileId })
        .from(mailboxes)
        .where(eq(mailboxes.id, mailboxId))
        .get();
      if (!mailbox) throw notFound(`Mailbox ${mailboxId} not found`, "mailbox_not_found");
      return taskQueue.enqueue({
        kind: "inbox_poll",
        payload: { mailboxId },
        profileId: mailbox.profileId,
        dedupeKey: `inbox_poll:${mailboxId}`,
      });
    },
  };
}
