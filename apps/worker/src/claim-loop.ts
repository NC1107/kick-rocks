import { sleepFor } from "@kickrocks/recipes";
import { type ClaimedTask, WORKER_DEFAULT_KINDS } from "@kickrocks/shared";
import { type WorkerApiClient, WorkerApiError } from "./api-client.js";
import type { WorkerConfig } from "./config.js";
import {
  type RunProgress,
  SubmitNotRecorded,
  type TaskExecutor,
  type TaskReport,
} from "./executor.js";
import { describeError, type Logger, silentLogger } from "./logger.js";

/** The calls the loop makes, so a test can stand in for the server. */
export type WorkerApi = Pick<
  WorkerApiClient,
  "heartbeat" | "claim" | "taskHeartbeat" | "complete" | "block" | "fail" | "release"
>;

export interface ClaimLoopContext {
  config: WorkerConfig;
  client: WorkerApi;
  signal: AbortSignal;
  executor: TaskExecutor;
  logger?: Logger;
  version?: string;
  /** Closes the browser when a run will not stop in time, which makes it fail fast. */
  forceStop?: () => Promise<void>;
  /** Told, between tasks, which profiles the server still has, so the browser data of others can go. */
  keepProfiles?: (profileIds: string[]) => Promise<void>;
  timing?: Partial<LoopTiming>;
}

export interface LoopTiming {
  /** How often a running task's lease is extended. */
  leaseHeartbeatMs: number;
  /** How often an idle worker tells the server it is alive. */
  idleHeartbeatMs: number;
  /** How long a run gets to stop after shutdown before the browser is closed under it. */
  shutdownGraceMs: number;
  /** The pause after a failed call grows from `pollMs` up to this. */
  maxBackoffMs: number;
  /** Tries for a report that can wait, and for any report once the worker is stopping. */
  reportAttempts: number;
  /** The first pause after a failed report. It doubles up to `maxBackoffMs`. */
  reportRetryMs: number;
}

function loopTiming(config: WorkerConfig, overrides: Partial<LoopTiming> = {}): LoopTiming {
  return {
    // A third of the lease keeps two heartbeats in hand if one is lost, capped so a long lease still beats often.
    leaseHeartbeatMs: Math.min(30_000, Math.max(2_000, Math.floor(config.leaseMs / 3))),
    idleHeartbeatMs: 30_000,
    shutdownGraceMs: 20_000,
    maxBackoffMs: 60_000,
    reportAttempts: 5,
    reportRetryMs: 1_000,
    ...overrides,
  };
}

/**
 * The server no longer lets this worker work on the task: it was cancelled or went elsewhere. A
 * lease that merely ran out is not this: the server still takes a late report from its holder.
 */
function leaseTaken(error: unknown): boolean {
  return (
    error instanceof WorkerApiError &&
    (error.code === "lease_not_held" || error.code === "task_not_found")
  );
}

function leaseLapsed(error: unknown): boolean {
  return error instanceof WorkerApiError && error.code === "lease_expired";
}

/** A report the server can never take, because the task is no longer this worker's. */
function leaseLost(error: unknown): boolean {
  return leaseTaken(error) || leaseLapsed(error);
}

/** A report that can be sent again: the server or the network failed, not the report. */
function transient(error: unknown): boolean {
  return !(error instanceof WorkerApiError) || error.status >= 500;
}

/** The server could not be reached, so nothing was judged: no answer came, or a proxy said it is down. */
function unreachable(error: unknown): boolean {
  return !(error instanceof WorkerApiError) || [502, 503, 504].includes(error.status);
}

/** A result, a block or a failure that will not be retried says what happened, however the run was stopped. */
function isFinal(report: TaskReport): boolean {
  return report.kind !== "release" && !(report.kind === "fail" && report.report.retryable);
}

class Loop {
  private readonly logger: Logger;
  private readonly timing: LoopTiming;
  private lastBeat = Number.NEGATIVE_INFINITY;
  private failures = 0;

  constructor(private readonly ctx: ClaimLoopContext) {
    this.logger = ctx.logger ?? silentLogger;
    this.timing = loopTiming(ctx.config, ctx.timing);
  }

  async run(): Promise<void> {
    const { signal, client, config } = this.ctx;
    this.logger.info("worker started", { workerId: config.workerId, server: config.serverUrl });
    while (!signal.aborted) {
      await this.beat(false, null);
      let task: ClaimedTask | null;
      try {
        task = await client.claim(WORKER_DEFAULT_KINDS, config.leaseMs);
        this.failures = 0;
      } catch (error) {
        await this.backOff("could not claim a task", error);
        continue;
      }
      if (task === null) {
        await sleepFor(config.pollMs, signal);
        continue;
      }
      await this.handle(task);
    }
    this.logger.info("worker stopped");
  }

  private async backOff(message: string, error: unknown): Promise<void> {
    this.failures += 1;
    const wait = Math.min(
      this.timing.maxBackoffMs,
      this.ctx.config.pollMs * 2 ** (this.failures - 1),
    );
    this.logger.warn(message, {
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
      const answer = await this.ctx.client.heartbeat({
        busy,
        currentTaskId: taskId,
        ...(this.ctx.version ? { version: this.ctx.version } : {}),
      });
      if (!busy && answer.profileIds) await this.forgetOtherProfiles(answer.profileIds);
    } catch (error) {
      this.logger.warn("worker heartbeat failed", { error: describeError(error) });
    }
  }

  private async forgetOtherProfiles(profileIds: string[]): Promise<void> {
    try {
      await this.ctx.keepProfiles?.(profileIds);
    } catch (error) {
      this.logger.warn("could not remove the browser data of deleted profiles", {
        error: describeError(error),
      });
    }
  }

  private async handle(task: ClaimedTask): Promise<void> {
    const { signal, client, config } = this.ctx;
    const log = { taskId: task.id, kind: task.kind, target: task.target.id, attempt: task.attempt };
    this.logger.info("claimed a task", log);
    await this.beat(true, task.id, true);

    const run = new AbortController();
    let lost = false;
    let forced = false;
    let graceTimer: NodeJS.Timeout | undefined;

    const onShutdown = () => {
      run.abort();
      graceTimer = setTimeout(() => {
        forced = true;
        this.logger.warn("the run did not stop in time, closing the browser", log);
        this.ctx.forceStop?.().catch(() => undefined);
      }, this.timing.shutdownGraceMs);
    };
    if (signal.aborted) onShutdown();
    else signal.addEventListener("abort", onShutdown, { once: true });

    let flagRequested = false;
    let recorded = false;
    const flaggedInFlight = new Set<Promise<unknown>>();
    // Any acknowledged heartbeat that carried the flag is the record, whoever sent it.
    const sendHeartbeat = async (): Promise<void> => {
      if (!flagRequested) {
        await client.taskHeartbeat(task.id, config.leaseMs);
        return;
      }
      const flagged = client.taskHeartbeat(task.id, config.leaseMs, true).then(() => {
        recorded = true;
      });
      const tracked = flagged.catch(() => undefined).finally(() => flaggedInFlight.delete(tracked));
      flaggedInFlight.add(tracked);
      await flagged;
    };
    // A flagged heartbeat that is still in flight when this one gives up may yet record the flag.
    const recordedByAnother = async (): Promise<boolean> => {
      await Promise.all([...flaggedInFlight]);
      return recorded;
    };
    const handleLeaseError = (error: unknown): void => {
      if (leaseTaken(error)) {
        lost = true;
        this.logger.warn("the lease on the task is gone, stopping the run", log);
        run.abort();
      } else if (leaseLapsed(error)) {
        // Stopping now would drop a result that the server still takes from its holder.
        this.logger.warn("the lease on the task ran out, finishing the run to report it", log);
        clearInterval(lease);
      } else {
        this.logger.warn("lease heartbeat failed", { ...log, error: describeError(error) });
      }
    };
    const extendLease = (): Promise<void> =>
      sendHeartbeat().then(
        () => undefined,
        (error: unknown) => handleLeaseError(error),
      );
    const lease = setInterval(() => {
      extendLease().then(() => this.beat(true, task.id, true));
    }, this.timing.leaseHeartbeatMs);
    const progress: RunProgress = {
      // Resolves only once the server acknowledged a heartbeat carrying the flag, because a click
      // made without that record could be submitted a second time if the lease then lapses.
      mayHaveSubmitted: async () => {
        if (recorded) return;
        flagRequested = true;
        let pause = this.timing.reportRetryMs;
        for (let tries = 1; ; tries++) {
          if (recorded) return;
          if (run.signal.aborted) throw new SubmitNotRecorded("the run was stopped");
          try {
            await sendHeartbeat();
            return;
          } catch (error) {
            if (await recordedByAnother()) return;
            if (
              !leaseTaken(error) &&
              !leaseLapsed(error) &&
              transient(error) &&
              tries < this.timing.reportAttempts
            ) {
              this.logger.warn("lease heartbeat failed, trying again", {
                ...log,
                error: describeError(error),
              });
              await sleepFor(pause, run.signal);
              pause *= 2;
              continue;
            }
            handleLeaseError(error);
            throw new SubmitNotRecorded(describeError(error));
          }
        }
      },
    };

    let report: TaskReport;
    try {
      report = await this.ctx.executor(task, run.signal, progress);
    } catch (error) {
      this.logger.error("the executor threw", { ...log, error: describeError(error) });
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
      this.logger.info("dropping the result of a task that is no longer ours", log);
      return;
    }
    if (forced && !isFinal(report))
      report = { kind: "release", reason: "the worker is shutting down" };
    await this.send(task, report, log);
    await this.beat(false, null, true);
  }

  private async send(task: ClaimedTask, report: TaskReport, log: Record<string, string | number>) {
    const { client } = this.ctx;
    const attempt = async (): Promise<void> => {
      switch (report.kind) {
        case "complete":
          try {
            await client.complete(task.id, report.result, report.usage, report.site);
          } catch (error) {
            // The server judged the result invalid, so it will never accept it: say the run failed.
            if (error instanceof WorkerApiError && error.status === 400) {
              this.logger.error("the server rejected a result", { ...log, message: error.message });
              await client.fail(task.id, {
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
          await client.block(task.id, report.report);
          return;
        case "fail":
          await client.fail(task.id, report.report);
          return;
        case "release":
          await client.release(task.id, report.retryAfterMs);
          return;
      }
    };

    // A result, block or final failure is the only record of a run that cannot be repeated, so it is
    // sent for as long as the server cannot be reached. Only a stopping worker gives up, because it
    // has to exit. A server that answers with an error would answer the same again, so that gets the
    // bounded tries and the lease expiring puts the task right.
    const mustLand = isFinal(report);
    let triesAfterShutdown = 0;
    let pause = this.timing.reportRetryMs;
    for (let tries = 1; ; tries++) {
      try {
        await attempt();
        this.logger.info("reported a task", { ...log, report: report.kind });
        return;
      } catch (error) {
        if (leaseLost(error)) {
          this.logger.warn("the server no longer holds this task for us", {
            ...log,
            error: describeError(error),
          });
          return;
        }
        if (this.ctx.signal.aborted) triesAfterShutdown += 1;
        const unbounded = mustLand && unreachable(error);
        const exhausted = (unbounded ? triesAfterShutdown : tries) >= this.timing.reportAttempts;
        if (!transient(error) || exhausted) {
          this.logger.error("could not report a task", { ...log, error: describeError(error) });
          return;
        }
        this.logger.warn("reporting failed, trying again", { ...log, error: describeError(error) });
        // The lease timer is stopped by now, so this is the only sign that the worker is alive.
        await this.beat(true, task.id);
        await sleepFor(pause, this.ctx.signal);
        pause = Math.min(pause * 2, this.timing.maxBackoffMs);
      }
    }
  }
}

/**
 * Claims one task at a time, keeps its lease alive while it runs, and reports the outcome. It
 * stops when the signal aborts: an idle worker leaves at once, and a worker mid-task asks the run
 * to stop and hands the task back so another worker can take it without an attempt being spent.
 */
export async function runClaimLoop(context: ClaimLoopContext): Promise<void> {
  await new Loop(context).run();
}
