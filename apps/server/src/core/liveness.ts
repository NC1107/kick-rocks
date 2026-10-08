import type { Clock } from "./clock.js";

/** How long the scheduler may go without finishing a maintenance pass before the server reports itself unhealthy. */
export const SCHEDULER_STALL_MS = 5 * 60 * 1000;

/**
 * How long one delivery pass (polls, sends, the digest) may run. A little over the email lease:
 * a pass that outlives it is waiting on a host that stopped answering, and every later send
 * waits behind it.
 */
export const DELIVERY_STALL_MS = 6 * 60 * 1000;

export interface SchedulerLiveness {
  lastPassAt: Date | null;
  stalled: boolean;
  /** When the oldest delivery pass still running began. */
  sendingSince: Date | null;
  sendingStalled: boolean;
}

/**
 * Whether the scheduler is still turning over, for the health check. The scheduler marks each
 * finished maintenance pass and brackets each delivery pass; the check reads them. A scheduler
 * that never started is not expected to pass, so tests and one-off tools are never reported as
 * stalled.
 */
export interface Liveness {
  /** The scheduler began running. A stall is measured from here until its first pass finishes. */
  expectScheduler(): void;
  markPass(): void;
  /** A delivery pass began. Pair it with `deliveryFinished` for the same lane. */
  deliveryStarted(lane: string): void;
  deliveryFinished(lane: string): void;
  scheduler(): SchedulerLiveness;
}

export function createLiveness(clock: Clock): Liveness {
  let expectedSince: number | null = null;
  let lastPassAt: Date | null = null;
  const deliveries = new Map<string, Date>();
  return {
    expectScheduler() {
      expectedSince ??= clock.now().getTime();
    },
    markPass() {
      lastPassAt = clock.now();
    },
    deliveryStarted(lane) {
      deliveries.set(lane, clock.now());
    },
    deliveryFinished(lane) {
      deliveries.delete(lane);
    },
    scheduler() {
      const now = clock.now().getTime();
      const sendingSince = [...deliveries.values()].sort((a, b) => a.getTime() - b.getTime())[0];
      const sendingStalled =
        sendingSince !== undefined && now - sendingSince.getTime() > DELIVERY_STALL_MS;
      const base = { lastPassAt, sendingSince: sendingSince ?? null, sendingStalled };
      if (expectedSince === null) return { ...base, stalled: false };
      const since = Math.max(expectedSince, lastPassAt?.getTime() ?? expectedSince);
      return { ...base, stalled: now - since > SCHEDULER_STALL_MS };
    },
  };
}
