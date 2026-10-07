import { applyRetention } from "../modules/data-rights/index.js";
import { runNotifications } from "../modules/notifications/index.js";
import { type Runners, runnersOf } from "../runners/index.js";
import type { AppServices } from "../services.js";
import { enqueueDueCanaries } from "./canaries.js";
import { advanceOverdueRequests } from "./overdue.js";
import { enqueueDueInboxPolls } from "./polls.js";
import { enqueueDueRescans } from "./rescans.js";

export interface SchedulerOptions {
  runners?: Runners;
  /** How often the loop wakes. Sends are paced in seconds, so this is short. */
  tickMs?: number;
  /** The most often the slower jobs (polls, deadlines, re-scans, canaries) run. */
  housekeepingMs?: number;
  /** The most often old artifacts are deleted. */
  retentionMs?: number;
}

export interface Scheduler {
  /** One pass of everything that is due. Passes never overlap: one that arrives during another is skipped. */
  tick(): Promise<void>;
  start(): void;
  /** Stops waking and waits for a pass in progress to finish. */
  stop(): Promise<void>;
}

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
  let inFlight: Promise<void> | null = null;

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

  async function pass(): Promise<void> {
    await job("reap-leases", () => services.taskQueue.reapExpiredLeases());
    if (due("housekeeping", housekeepingMs)) {
      await job("inbox-polls", () => enqueueDueInboxPolls(services));
      await job("overdue-requests", () => advanceOverdueRequests(services));
      await job("rescans", () => enqueueDueRescans(services));
      await job("canaries", () => enqueueDueCanaries(services));
      await job("notifications", () => runNotifications(services));
    }
    if (due("retention", retentionMs)) {
      await job("retention", () => applyRetention(services, { compact: "when-worthwhile" }));
    }
    await job("runners", () => runners.runDue());
  }

  const scheduler: Scheduler = {
    tick() {
      if (inFlight) return inFlight;
      inFlight = pass().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },

    start() {
      if (timer) return;
      timer = setInterval(() => void scheduler.tick(), tickMs);
      timer.unref();
      void scheduler.tick();
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await inFlight;
    },
  };
  return scheduler;
}
