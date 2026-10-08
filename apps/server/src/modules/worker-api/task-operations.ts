import type {
  BlockedReason,
  BrowserTaskKind,
  ClaimedTask,
  ClaimerKind,
  RequestActor,
  SiteObservation,
  TaskBlockReport,
  TaskFailureReport,
  TaskSummary,
  TaskUsage,
} from "@kickrocks/shared";
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
export interface Caller {
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

export interface ClaimRequest {
  workerId: string;
  kinds: readonly BrowserTaskKind[];
  leaseMs: number;
  taskId?: string | undefined;
  claimerKind: ClaimerKind;
}

export interface TaskOperations {
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
>;

/**
 * A claim that fails while preparing a task fails that task for good before it throws, so the next
 * claim moves on. A handful of retries keeps one malformed task from hiding the healthy ones
 * behind it, and a bounded count keeps a systemic fault from failing the whole queue.
 */
const MAX_UNPREPARABLE_TASKS = 5;

/**
 * A client that parks a task for a CAPTCHA or a bot check has told us the site is challenging it,
 * even when it sent no observation, so the site is left alone the same as when a worker says so.
 */
function impliedByBlock(reason: BlockedReason): SiteObservation | undefined {
  if (reason === "captcha") return { pushback: { kind: "captcha" } };
  if (reason === "bot_detection") return { pushback: { kind: "challenge" } };
  return undefined;
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
      observeBeforeTransition(taskId, site);
      return services.db.transaction(() => {
        const done = taskQueue.complete(taskId, { workerId, result, usage, actor: caller.actor });
        if (!site?.pushback) politeness.recordClean(done);
        return summarize(done);
      });
    },

    block(taskId, { workerId, reason, detail, url, screenshot, usage, site }) {
      authorize(taskId);
      const seen = site ?? impliedByBlock(reason);
      observeBeforeTransition(taskId, seen);
      return services.db.transaction(() => {
        const blocked = taskQueue.block(taskId, {
          workerId,
          reason,
          detail,
          url,
          screenshot: screenshot ? decodeScreenshot(screenshot) : undefined,
          usage,
          actor: caller.actor,
        });
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
      const outcome = observeBeforeTransition(taskId, site);
      return services.db.transaction(() => {
        if (outcome) {
          // A site that pushes back is left alone until its cooldown ends: no retry on the usual
          // backoff, no attempt used, and no hand-off to an agent that would try again sooner.
          return summarize(
            taskQueue.defer(taskId, {
              workerId,
              until: new Date(outcome.cooldownUntil),
              reason: `${error} The site is being left alone until ${outcome.cooldownUntil}.`.slice(
                0,
                2000,
              ),
              actor: caller.actor,
              usage,
            }),
          );
        }
        return summarize(
          taskQueue.fail(taskId, {
            workerId,
            error,
            retryable,
            kind,
            step,
            retryAfterMs,
            usage,
            actor: caller.actor,
          }),
        );
      });
    },

    release(taskId, { workerId, retryAfterMs }) {
      authorize(taskId);
      const runAfter = retryAfterMs ? new Date(clock.now().getTime() + retryAfterMs) : undefined;
      return summarize(taskQueue.release(taskId, { workerId, runAfter }));
    },
  };
}
