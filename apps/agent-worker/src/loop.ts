import { sleepFor } from "@kickrocks/recipes";
import type { ClaimedTask } from "@kickrocks/shared";
import { AGENT_DEFAULT_KINDS } from "@kickrocks/shared";
import { type WorkerApiClient, WorkerApiError } from "@kickrocks/worker/dist/api-client.js";
import type { TaskReport } from "@kickrocks/worker/dist/executor.js";
import { describeError, type Logger } from "@kickrocks/worker/dist/logger.js";

export type AgentTask = Extract<ClaimedTask, { kind: "agent" }>;

/** The calls the loop makes, so a test can stand in for the server. */
export type AgentApi = Pick<
  WorkerApiClient,
  "heartbeat" | "claim" | "taskHeartbeat" | "complete" | "block" | "fail" | "release"
>;

export type AgentExecutor = (task: AgentTask, signal: AbortSignal) => Promise<TaskReport>;

export interface LoopTiming {
  leaseHeartbeatMs: number;
  idleHeartbeatMs: number;
  /** How long a run gets to stop after shutdown before the browser is closed under it. */
  shutdownGraceMs: number;
  maxBackoffMs: number;
  reportAttempts: number;
  reportRetryMs: number;
}

export interface LoopContext {
  api: AgentApi;
  executor: AgentExecutor;
  signal: AbortSignal;
  logger: Logger;
  workerId: string;
  pollMs: number;
  leaseMs: number;
  version?: string;
  /** Closes the browser when a run will not stop in time, which makes it fail fast. */
  forceStop?: () => Promise<void>;
  timing?: Partial<LoopTiming>;
}

export function loopTiming(leaseMs: number, overrides: Partial<LoopTiming> = {}): LoopTiming {
  return {
    leaseHeartbeatMs: Math.min(30_000, Math.max(2_000, Math.floor(leaseMs / 3))),
    idleHeartbeatMs: 30_000,
    shutdownGraceMs: 20_000,
    maxBackoffMs: 60_000,
    reportAttempts: 5,
    reportRetryMs: 1_000,
    ...overrides,
  };
}

/** The server no longer lets this worker work on the task: it was cancelled or went elsewhere. */
function leaseTaken(error: unknown): boolean {
  return (
    error instanceof WorkerApiError &&
    (error.code === "lease_not_held" || error.code === "task_not_found")
  );
}

function leaseLapsed(error: unknown): boolean {
  return error instanceof WorkerApiError && error.code === "lease_expired";
}

function transient(error: unknown): boolean {
  return !(error instanceof WorkerApiError) || error.status >= 500;
}

class Loop {
  private readonly timing: LoopTiming;
  private lastBeat = Number.NEGATIVE_INFINITY;
  private failures = 0;

  constructor(private readonly ctx: LoopContext) {
    this.timing = loopTiming(ctx.leaseMs, ctx.timing);
  }

  async run(): Promise<void> {
    const { signal, api, logger } = this.ctx;
    logger.info("agent worker started", { workerId: this.ctx.workerId });
    while (!signal.aborted) {
      await this.beat(false, null);
      let task: ClaimedTask | null;
      try {
        task = await api.claim(AGENT_DEFAULT_KINDS, this.ctx.leaseMs);
        this.failures = 0;
      } catch (error) {
        await this.backOff("could not claim a task", error);
        continue;
      }
      if (task === null) {
        await sleepFor(this.ctx.pollMs, signal);
        continue;
      }
      if (task.kind !== "agent") {
        // The server was asked for agent tasks only, so this is a server bug; give it back at once.
        logger.error("claimed a task that is not an agent task", {
          taskId: task.id,
          kind: task.kind,
        });
        await this.send(
          task,
          { kind: "release", reason: "not an agent task", retryAfterMs: 60_000 },
          {
            taskId: task.id,
          },
        );
        continue;
      }
      await this.handle(task);
    }
    logger.info("agent worker stopped");
  }

  private async backOff(message: string, error: unknown): Promise<void> {
    this.failures += 1;
    const wait = Math.min(this.timing.maxBackoffMs, this.ctx.pollMs * 2 ** (this.failures - 1));
    this.ctx.logger.warn(message, {
      error: describeError(error),
      status: error instanceof WorkerApiError ? error.status : undefined,
      retryInMs: wait,
    });
    await sleepFor(wait, this.ctx.signal);
  }

  private async beat(busy: boolean, taskId: string | null, force = false): Promise<void> {
    const at = Date.now();
    if (!force && at - this.lastBeat < this.timing.idleHeartbeatMs) return;
    this.lastBeat = at;
    try {
      await this.ctx.api.heartbeat({
        busy,
        currentTaskId: taskId,
        ...(this.ctx.version ? { version: this.ctx.version } : {}),
      });
    } catch (error) {
      this.ctx.logger.warn("worker heartbeat failed", { error: describeError(error) });
    }
  }

  private async handle(task: AgentTask): Promise<void> {
    const { signal, api, logger } = this.ctx;
    const log = { taskId: task.id, target: task.target.id, attempt: task.attempt };
    logger.info("claimed a task", log);
    await this.beat(true, task.id, true);

    const run = new AbortController();
    let lost = false;
    let forced = false;
    let graceTimer: NodeJS.Timeout | undefined;

    const onShutdown = () => {
      run.abort();
      graceTimer = setTimeout(() => {
        forced = true;
        logger.warn("the run did not stop in time, closing the browser", log);
        this.ctx.forceStop?.().catch(() => undefined);
      }, this.timing.shutdownGraceMs);
    };
    if (signal.aborted) onShutdown();
    else signal.addEventListener("abort", onShutdown, { once: true });

    const lease = setInterval(() => {
      api
        .taskHeartbeat(task.id, this.ctx.leaseMs)
        .then(() => this.beat(true, task.id, true))
        .catch((error: unknown) => {
          if (leaseTaken(error)) {
            lost = true;
            logger.warn("the lease on the task is gone, stopping the run", log);
            run.abort();
          } else if (leaseLapsed(error)) {
            // Stopping now would drop a result that the server still takes from its holder.
            logger.warn("the lease on the task ran out, finishing the run to report it", log);
            clearInterval(lease);
          } else {
            logger.warn("lease heartbeat failed", { ...log, error: describeError(error) });
          }
        });
    }, this.timing.leaseHeartbeatMs);

    let report: TaskReport;
    try {
      report = await this.ctx.executor(task, run.signal);
    } catch (error) {
      logger.error("the executor threw", { ...log, error: describeError(error) });
      report = {
        kind: "fail",
        report: {
          error: describeError(error) || "The run failed",
          retryable: true,
          kind: "internal",
        },
      };
    } finally {
      clearInterval(lease);
      clearTimeout(graceTimer);
      signal.removeEventListener("abort", onShutdown);
    }

    if (lost) {
      logger.info("dropping the result of a task that is no longer ours", log);
      return;
    }
    if (forced) report = { kind: "release", reason: "the worker is shutting down" };
    await this.send(task, report, log);
    await this.beat(false, null, true);
  }

  private async send(task: ClaimedTask, report: TaskReport, log: Record<string, string | number>) {
    const { api, logger } = this.ctx;
    const attempt = async (): Promise<void> => {
      switch (report.kind) {
        case "complete":
          try {
            await api.complete(task.id, report.result, report.usage);
          } catch (error) {
            // The server judged the result invalid, so it will never accept it: say the run failed.
            if (error instanceof WorkerApiError && error.status === 400) {
              logger.error("the server rejected a result", { ...log, message: error.message });
              await api.fail(task.id, {
                error: `The server rejected the result: ${error.message}`.slice(0, 2000),
                retryable: false,
                kind: "internal",
                usage: report.usage,
              });
              return;
            }
            throw error;
          }
          return;
        case "block":
          await api.block(task.id, report.report);
          return;
        case "fail":
          await api.fail(task.id, report.report);
          return;
        case "release":
          await api.release(task.id, report.retryAfterMs);
          return;
      }
    };

    let pause = this.timing.reportRetryMs;
    for (let tries = 1; ; tries++) {
      try {
        await attempt();
        logger.info("reported a task", { ...log, report: report.kind });
        return;
      } catch (error) {
        if (leaseTaken(error) || leaseLapsed(error)) {
          logger.warn("the server no longer holds this task for us", {
            ...log,
            error: describeError(error),
          });
          return;
        }
        if (!transient(error) || tries >= this.timing.reportAttempts) {
          logger.error("could not report a task", { ...log, error: describeError(error) });
          return;
        }
        logger.warn("reporting failed, trying again", { ...log, error: describeError(error) });
        await sleepFor(pause);
        pause *= 2;
      }
    }
  }
}

/**
 * Claims one agent task at a time, keeps its lease alive while the model works, and reports the
 * outcome. On shutdown a run in progress is asked to stop and the task goes back unspent.
 */
export async function runLoop(context: LoopContext): Promise<void> {
  await new Loop(context).run();
}
