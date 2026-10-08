import type { Clock } from "./clock.js";

/** How long the scheduler may go without finishing a maintenance pass before the server reports itself unhealthy. */
export const SCHEDULER_STALL_MS = 5 * 60 * 1000;

/**
 * Whether the scheduler is still turning over, for the health check. The scheduler marks each
 * finished maintenance pass; the check reads it. A scheduler that never started is not expected
 * to pass, so tests and one-off tools are never reported as stalled.
 */
export interface Liveness {
  /** The scheduler began running. A stall is measured from here until its first pass finishes. */
  expectScheduler(): void;
  markPass(): void;
  scheduler(): { lastPassAt: Date | null; stalled: boolean };
}

export function createLiveness(clock: Clock): Liveness {
  let expectedSince: number | null = null;
  let lastPassAt: Date | null = null;
  return {
    expectScheduler() {
      expectedSince ??= clock.now().getTime();
    },
    markPass() {
      lastPassAt = clock.now();
    },
    scheduler() {
      if (expectedSince === null) return { lastPassAt, stalled: false };
      const since = Math.max(expectedSince, lastPassAt?.getTime() ?? expectedSince);
      return { lastPassAt, stalled: clock.now().getTime() - since > SCHEDULER_STALL_MS };
    },
  };
}
