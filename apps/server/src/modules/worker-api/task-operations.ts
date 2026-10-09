import { setTimeout } from "node:timers/promises";
import type {
  BlockedReason,
  BrowserTaskKind,
  ClaimedTask,
  ClaimerKind,
  FormOutcome,
  ModelIdentity,
  ReleaseBody,
  RequestActor,
  SendResultBody,
  SendsBody,
  SendsResponse,
  SiteObservation,
  TaskBlockReport,
  TaskFailureReport,
  TaskSummary,
  TaskUsage,
  WorkerDecision,
} from "@kickrocks/shared";
import { pushbackKindForStatus } from "@kickrocks/shared";
import { claimTask } from "../../core/claim.js";
import { AppError, conflict, invalidRequest, notFound } from "../../core/errors.js";
import type { PushbackOutcome } from "../../core/site-politeness.js";
import type { Task } from "../../core/task-types.js";
import type { AppServices } from "../../services.js";
import { decodeScreenshot } from "./screenshot.js";

/**
 * Who is calling. The worker API and the MCP server do the same work on the same queue, and this
 * is the only difference between them: how a caller is recorded and which tasks it may touch.
 */
interface Caller {
  actor: RequestActor;
  /** Whether a task claimed by this kind of claimer is this caller's to report on. */
  owns(claimerKind: ClaimerKind | null): boolean;
  /** Only a recipe run can fail with kind `recipe`; an agent follows instructions instead. */
  mayReportRecipeFailure: boolean;
}

/** The built-in worker and any model-backed worker that uses the worker token. */
export const WORKER_CALLER: Caller = {
  actor: "worker",
  owns: (claimerKind) => claimerKind !== "mcp",
  mayReportRecipeFailure: true,
};

/** An MCP client. It cannot report on a task the built-in worker holds, whatever worker id it gives. */
export const MCP_CALLER: Caller = {
  actor: "agent",
  owns: (claimerKind) => claimerKind === "mcp",
  mayReportRecipeFailure: false,
};

interface ClaimRequest {
  workerId: string;
  kinds: readonly BrowserTaskKind[];
  leaseMs: number;
  taskId?: string | undefined;
  claimerKind: ClaimerKind;
  model?: ModelIdentity | undefined;
}

/** A removal that ended in one of these sent the form, which the site received. */
const SENDING_OUTCOMES: readonly FormOutcome[] = ["submitted", "awaiting_email_confirmation"];

function reportsSentForm(result: unknown): boolean {
  const outcome = (result as { form?: { outcome?: unknown } } | null)?.form?.outcome;
  return SENDING_OUTCOMES.some((sending) => sending === outcome);
}

interface TaskOperations {
  claim(request: ClaimRequest): ClaimedTask | null;
  heartbeat(
    taskId: string,
    request: { workerId: string; leaseMs: number; mayHaveSubmitted?: boolean | undefined },
  ): { leaseExpiresAt: string };
  complete(
    taskId: string,
    request: {
      workerId: string;
      result: unknown;
      usage?: TaskUsage | undefined;
      site?: SiteObservation | undefined;
    },
  ): TaskSummary;
  block(taskId: string, request: TaskBlockReport & { workerId: string }): TaskSummary;
  fail(taskId: string, request: TaskFailureReport & { workerId: string }): TaskSummary;
  release(
    taskId: string,
    request: { workerId: string; retryAfterMs?: number | undefined },
  ): TaskSummary;
  /** Records what the outgoing gate decided, and holds the requests that wait for a person. */
  registerSends(taskId: string, body: SendsBody): SendsResponse;
  /** Waits up to `waitMs` for a person to decide a held request. */
  awaitDecision(
    taskId: string,
    sendId: string,
    workerId: string,
    waitMs: number,
  ): Promise<WorkerDecision>;
  /** The worker asks to let a held request go; the answer is only ever ok after it is on record. */
  releaseSend(taskId: string, sendId: string, body: ReleaseBody): { releaseId: string };
  sendResult(taskId: string, sendId: string, body: SendResultBody): void;
}

type OperationServices = Pick<
  AppServices,
  | "db"
  | "clock"
  | "targets"
  | "taskQueue"
  | "requests"
  | "legal"
  | "dispatch"
  | "settings"
  | "politeness"
  | "taskSends"
  | "logger"
>;

/**
 * A claim that fails while preparing a task fails that task for good before it throws, so the next
 * claim moves on. A handful of retries keeps one malformed task from hiding the healthy ones
 * behind it, and a bounded count keeps a systemic fault from failing the whole queue.
 */
const MAX_UNPREPARABLE_TASKS = 5;

/** How often a waiting request looks again for a person's decision. */
const DECISION_POLL_MS = 200;

/**
 * A client that parks a task for a CAPTCHA or a bot check has told us the site is challenging it,
 * even when it sent no observation, so the site is left alone the same as when a worker says so.
 */
function impliedByBlock(reason: BlockedReason): SiteObservation | undefined {
  if (reason === "captcha") return { pushback: { kind: "captcha" } };
  if (reason === "bot_detection") return { pushback: { kind: "challenge" } };
  return undefined;
}

/**
 * A client that says only "the site answered 429" in its error text has still told us the site
 * pushed back. Without this the report would get the normal retry backoff and the site no cooldown.
 */
function impliedByError(
  error: string,
  kind: TaskFailureReport["kind"],
): SiteObservation | undefined {
  if (kind !== "site") return undefined;
  const status = /\b(429|403|503)\b/.exec(error)?.[1];
  if (status !== undefined) {
    const code = Number(status);
    const pushbackKind = pushbackKindForStatus(code);
    if (pushbackKind) return { pushback: { kind: pushbackKind, status: code } };
  }
  return /too many requests/i.test(error)
    ? { pushback: { kind: "rate_limited", status: 429 } }
    : undefined;
}

/**
 * Whether a finished task proves the site treated the visit normally. A search that found nobody
 * and never saw the site's own "no results" message may have met a soft block that looked like an
 * empty page, so it must not close a breaker or clear the pushback count. A canary is held to the
 * same standard: a page whose known selectors are missing proves nothing.
 */
function showsSiteWorking(task: Task): boolean {
  // A canary that missed the recipe's selectors saw a page the site may have emptied on purpose.
  if (task.kind === "canary") return task.result?.healthy === true;
  const scan =
    task.kind === "scan"
      ? task.result
      : task.kind === "agent" && task.result?.purpose === "scan"
        ? task.result.scan
        : null;
  if (scan === null || scan === undefined) return true;
  return scan.candidates.length > 0 || scan.noResultsShown === true;
}

/**
 * Whether a result a client is about to report is a scan that found nobody and never saw the
 * site's own "no results" message. It reads the raw result because the task must not complete
 * first: completing is what saves the scan as finished.
 */
function reportsUnconfirmedEmptyScan(task: Task, result: unknown): boolean {
  const scan = task.kind === "agent" ? (result as { scan?: unknown } | null)?.scan : result;
  if (task.kind !== "scan" && !(task.kind === "agent" && task.payload.purpose === "scan")) {
    return false;
  }
  const { candidates, noResultsShown } = (scan ?? {}) as {
    candidates?: unknown;
    noResultsShown?: unknown;
  };
  return Array.isArray(candidates) && candidates.length === 0 && noResultsShown !== true;
}

/** What a client said of the site, with what the report itself implies filling in a missing pushback. */
function withImplied(
  site: SiteObservation | undefined,
  implied: SiteObservation | undefined,
): SiteObservation | undefined {
  const pushback = site?.pushback ?? implied?.pushback;
  if (site === undefined && pushback === undefined) return undefined;
  return { ...site, ...(pushback === undefined ? {} : { pushback }) };
}

/** Holds a task back until its site's cooldown ends, without using an attempt. */
function deferUntilCalm(
  taskQueue: OperationServices["taskQueue"],
  caller: Caller,
  taskId: string,
  workerId: string,
  outcome: PushbackOutcome,
  message: string,
  usage: TaskUsage | undefined,
): Task {
  return taskQueue.defer(taskId, {
    workerId,
    until: new Date(outcome.cooldownUntil),
    reason: `${message} The site is being left alone until ${outcome.cooldownUntil}.`.slice(
      0,
      2000,
    ),
    actor: caller.actor,
    usage,
  });
}

export function createTaskOperations(services: OperationServices, caller: Caller): TaskOperations {
  const { taskQueue, clock, politeness } = services;

  function summarize(task: Task): TaskSummary {
    const [summary] = taskQueue.summarize([task]);
    if (!summary) throw new AppError(500, "internal_error", "A task could not be summarized");
    return summary;
  }

  function authorize(taskId: string): void {
    const task = taskQueue.get(taskId);
    if (!task) throw notFound(`Task ${taskId} not found`, "task_not_found");
    if (!caller.owns(task.claimerKind)) {
      throw conflict("lease_not_held", `Task ${taskId} was not claimed through this interface`);
    }
  }

  /**
   * What a run saw of the site is recorded on its own, before the task moves. A worker held up by a
   * throttling site can report after its lease ran out, the move is then refused, and the site must
   * still be left alone.
   */
  function observeBeforeTransition(
    taskId: string,
    site: SiteObservation | undefined,
  ): PushbackOutcome | null {
    return services.db.transaction(() => politeness.observe(taskQueue.getOrThrow(taskId), site));
  }

  /**
   * An agent that is not cleared to work alone cannot send a form without a person's approval,
   * and every approved send is on record before it leaves. A report of a sent form with no send on
   * record is therefore not believed, and the task is parked for a person to check the site.
   */
  function holdUnbackedSubmit(taskId: string, workerId: string, result: unknown): void {
    const task = taskQueue.get(taskId);
    if (task?.kind !== "agent" || task.submitApproval !== "required") return;
    if (!reportsSentForm(result)) return;
    if (services.taskSends.releasesInRun(taskId) > 0) return;
    taskQueue.block(taskId, {
      workerId,
      reason: "unknown",
      detail:
        "The run says it sent the form, but nothing carrying your details left the browser. Check the site before you run it again.",
      actor: "system",
    });
    services.taskSends.endRun(taskId);
    throw conflict(
      "nothing_sent",
      "The run reported a sent form, but no request carrying the person's details was released",
    );
  }

  /**
   * Approving runs the held requests again, so a run that sent something nobody approved cannot
   * ask for that. While every release was an approved one the reason stays as it was.
   */
  function reasonToReport(taskId: string, reason: BlockedReason): BlockedReason {
    if (reason !== "approval_needed") return reason;
    return services.taskSends.hasUnapprovedRelease(taskId) ? "unapproved_submit" : reason;
  }

  /**
   * Only a model-backed run held back by the gate can ask for an approval. An MCP client, a
   * built-in run or a model that was cleared has none to ask for, and an approval it asked for
   * would unlock a run with no limits.
   */
  function refuseUnearnedApprovalStop(taskId: string, reason: BlockedReason): void {
    if (reason !== "approval_needed" && reason !== "unapproved_submit") return;
    const task = taskQueue.get(taskId);
    const gated =
      task?.kind === "agent" && task.claimerKind === "model" && task.submitApproval === "required";
    if (gated) return;
    throw conflict(
      "approval_not_applicable",
      "Only a model-backed run that needs a person's approval to submit can report this reason",
    );
  }

  function holdCapMs(): number {
    return services.settings.get("agent.approvalHoldMinutes") * 60_000;
  }

  return {
    claim({ taskId, ...request }) {
      if (taskId !== undefined) return claimTask(services, { ...request, taskId });
      let lastError: unknown;
      for (let attempt = 0; attempt <= MAX_UNPREPARABLE_TASKS; attempt++) {
        try {
          return claimTask(services, request);
        } catch (error) {
          if (!(error instanceof AppError) || error.status >= 500) throw error;
          lastError = error;
        }
      }
      throw lastError;
    },

    heartbeat(taskId, { workerId, leaseMs, mayHaveSubmitted }) {
      authorize(taskId);
      const task = taskQueue.heartbeat(taskId, { workerId, leaseMs, mayHaveSubmitted });
      if (task.leaseExpiresAt === null) {
        throw new AppError(500, "internal_error", "A leased task has no lease expiry");
      }
      return { leaseExpiresAt: task.leaseExpiresAt };
    },

    complete(taskId, { workerId, result, usage, site }) {
      authorize(taskId);
      const outcome = observeBeforeTransition(taskId, site);
      holdUnbackedSubmit(taskId, workerId, result);
      return services.db.transaction(() => {
        // An empty search after the site pushed back says nothing about the person, so the scan is
        // not finished: the task waits out the cooldown and searches again.
        if (outcome && reportsUnconfirmedEmptyScan(taskQueue.getOrThrow(taskId), result)) {
          return summarize(
            deferUntilCalm(
              taskQueue,
              caller,
              taskId,
              workerId,
              outcome,
              "The site pushed back before the search showed anything.",
              usage,
            ),
          );
        }
        const done = taskQueue.complete(taskId, { workerId, result, usage, actor: caller.actor });
        services.taskSends.endRun(taskId);
        if (!site?.pushback && showsSiteWorking(done)) politeness.recordClean(done);
        return summarize(done);
      });
    },

    block(taskId, { workerId, reason, detail, url, screenshot, usage, site }) {
      authorize(taskId);
      refuseUnearnedApprovalStop(taskId, reason);
      const seen = withImplied(site, impliedByBlock(reason));
      observeBeforeTransition(taskId, seen);
      return services.db.transaction(() => {
        const blocked = taskQueue.block(taskId, {
          workerId,
          reason: reasonToReport(taskId, reason),
          detail,
          url,
          screenshot: screenshot ? decodeScreenshot(screenshot) : undefined,
          usage,
          actor: caller.actor,
        });
        services.taskSends.endRun(taskId);
        if (!seen?.pushback) politeness.recordClean(blocked);
        return summarize(blocked);
      });
    },

    fail(taskId, { workerId, error, retryable, kind, step, retryAfterMs, usage, site }) {
      authorize(taskId);
      if (kind === "recipe" && !caller.mayReportRecipeFailure) {
        throw invalidRequest("Only a recipe run can fail with kind recipe", [
          {
            path: ["kind"],
            message: "An agent does not run a recipe; use site, network, or internal",
          },
        ]);
      }
      const outcome = observeBeforeTransition(
        taskId,
        withImplied(site, impliedByError(error, kind)),
      );
      return services.db.transaction(() => {
        const ended = outcome
          ? // A site that pushes back is left alone until its cooldown ends: no retry on the usual
            // backoff, no attempt used, and no hand-off to an agent that would try again sooner.
            deferUntilCalm(taskQueue, caller, taskId, workerId, outcome, error, usage)
          : taskQueue.fail(taskId, {
              workerId,
              error,
              retryable,
              kind,
              step,
              retryAfterMs,
              usage,
              actor: caller.actor,
            });
        services.taskSends.endRun(taskId);
        return summarize(ended);
      });
    },

    release(taskId, { workerId, retryAfterMs }) {
      authorize(taskId);
      const runAfter = retryAfterMs ? new Date(clock.now().getTime() + retryAfterMs) : undefined;
      return services.db.transaction(() => {
        const released = taskQueue.release(taskId, { workerId, runAfter });
        services.taskSends.endRun(taskId);
        return summarize(released);
      });
    },

    registerSends(taskId, { workerId, attempt, items }) {
      authorize(taskId);
      const sends = services.taskSends.register(
        taskId,
        workerId,
        attempt,
        items.map((item) =>
          item.kind === "held"
            ? {
                ...item,
                screenshot: item.screenshot ? decodeScreenshot(item.screenshot) : undefined,
              }
            : item,
        ),
        holdCapMs(),
      );
      return { sends };
    },

    async awaitDecision(taskId, sendId, workerId, waitMs) {
      authorize(taskId);
      const task = taskQueue.getOrThrow(taskId);
      if (task.leaseOwner !== workerId) {
        throw conflict("lease_not_held", `Task ${taskId} is not leased to ${workerId}`);
      }
      const deadline = Date.now() + waitMs;
      for (;;) {
        const decision = services.taskSends.workerDecision(taskId, sendId);
        if (decision.status !== "pending" || Date.now() >= deadline) return decision;
        await setTimeout(Math.min(DECISION_POLL_MS, Math.max(1, deadline - Date.now())));
      }
    },

    releaseSend(taskId, sendId, { workerId, request }) {
      authorize(taskId);
      return {
        releaseId: services.taskSends.release(taskId, workerId, sendId, request),
      };
    },

    sendResult(taskId, sendId, { status, error }) {
      authorize(taskId);
      services.taskSends.result(taskId, sendId, { status, error });
    },
  };
}
