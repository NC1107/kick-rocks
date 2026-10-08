import { reuseRecentScans } from "../core/scan-reuse.js";
import { applyRetention } from "../modules/data-rights/index.js";
import { runNotifications } from "../modules/notifications/index.js";
import { type Runners, runnersOf } from "../runners/index.js";
import type { AppServices } from "../services.js";
import { enqueueDueCanaries } from "./canaries.js";
import { advanceOverdueRequests } from "./overdue.js";
import { enqueueDueInboxPolls } from "./polls.js";
import { enqueueDueRescans } from "./rescans.js";

interface SchedulerOptions {
  runners?: Runners;
  /** How often the loop wakes. Sends are paced in seconds, so this is short. */
  tickMs?: number;
  /** The most often the slower jobs (polls, deadlines, re-scans, canaries) run. */
  housekeepingMs?: number;
  /** The most often old artifacts are deleted. */
  retentionMs?: number;
}

export interface Scheduler {
  /**
   * One pass of everything that is due: maintenance, then the runners. Neither lane overlaps
   * itself. A maintenance pass that arrives during another waits for it, while a runner pass that
   * arrives during a long send is skipped, so a send that never answers never holds up the rest.
   */
  tick(): Promise<void>;
  start(): void;
  /**
   * Stops waking and waits for the passes in progress. A pass still running after `graceMs` is
   * left behind and the leases its runners hold are handed back, so shutdown is bounded and the
   * unfinished sends come due again at once instead of after their lease runs out.
   */
  stop(options?: { graceMs?: number }): Promise<void>;
}

/** Leases of the in-process runners, which share this prefix and are returned when shutdown gives up on them. */
const RUNNER_LEASE_PREFIX = "server:";

/**
 * The loop that keeps Kick Rocks working unattended. Every job reads time from the injected
 * clock and writes through the shared services, so a test advances the fake clock and calls
 * `tick`, and the same code runs in production on a timer.
 */
export function createScheduler(
  services: AppServices,
  {
    runners = runnersOf(services),
    tickMs = 5_000,
    housekeepingMs = 60_000,
    retentionMs = 60 * 60 * 1000,
  }: SchedulerOptions = {},
): Scheduler {
  const lastRun = new Map<string, number>();
  let timer: NodeJS.Timeout | null = null;

  const due = (job: string, everyMs: number): boolean => {
    const now = services.clock.now().getTime();
    const last = lastRun.get(job);
    if (last !== undefined && now - last < everyMs) return false;
    lastRun.set(job, now);
    return true;
  };

  /** A job that throws must not stop the others, so each failure is logged and the pass goes on. */
  const job = async (name: string, run: () => unknown): Promise<void> => {
    try {
      await run();
    } catch (error) {
      services.logger.error({ job: name, err: error }, "scheduler job failed");
    }
  };

  /** Runs `body` one at a time. */
  const lane = (body: () => Promise<void>) => {
    let inFlight: Promise<void> | null = null;
    return {
      busy: () => inFlight !== null,
      run(): Promise<void> {
        inFlight ??= body().finally(() => {
          inFlight = null;
        });
        return inFlight;
      },
      settled: () => inFlight ?? Promise.resolve(),
    };
  };

  /** Everything except sending. It only touches the database, so no network host can stall it. */
  const maintenance = lane(async () => {
    await job("reap-leases", () => services.taskQueue.reapExpiredLeases());
    if (due("housekeeping", housekeepingMs)) {
      await job("inbox-polls", () => enqueueDueInboxPolls(services));
      await job("overdue-requests", () => advanceOverdueRequests(services));
      await job("rescans", () => enqueueDueRescans(services));
      await job("scan-reuse", () => reuseRecentScans(services));
      await job("site-visits", () => services.politeness.prune());
      await job("canaries", () => enqueueDueCanaries(services));
      await job("notifications", () => runNotifications(services));
    }
    if (due("retention", retentionMs)) {
      await job("retention", () => applyRetention(services, { compact: "when-worthwhile" }));
    }
    services.liveness.markPass();
  });

  /** Polls and sends wait on mail servers, so they get a lane of their own. */
  const sending = lane(() => job("runners", () => runners.runDue()));

  const releaseRunnerLeases = (): void => {
    for (const task of services.taskQueue.list({ status: "leased" })) {
      if (!task.leaseOwner?.startsWith(RUNNER_LEASE_PREFIX)) continue;
      services.taskQueue.release(task.id, { workerId: task.leaseOwner });
    }
  };

  const scheduler: Scheduler = {
    async tick() {
      await maintenance.run();
      if (!sending.busy()) await sending.run();
    },

    start() {
      if (timer) return;
      services.liveness.expectScheduler();
      timer = setInterval(() => void scheduler.tick(), tickMs);
      timer.unref();
      void scheduler.tick();
    },

    async stop({ graceMs } = {}) {
      if (timer) clearInterval(timer);
      timer = null;
      const settled = Promise.all([maintenance.settled(), sending.settled()]);
      if (graceMs === undefined) {
        await settled;
        return;
      }
      let giveUp: NodeJS.Timeout | undefined;
      const outcome = await Promise.race([
        settled.then(() => "settled" as const),
        new Promise<"late">((resolve) => {
          giveUp = setTimeout(() => resolve("late"), graceMs);
        }),
      ]);
      clearTimeout(giveUp);
      if (outcome === "late") {
        services.logger.warn(
          "a scheduler pass did not finish in time, so its leases are handed back",
        );
        releaseRunnerLeases();
      }
    },
  };
  return scheduler;
}
