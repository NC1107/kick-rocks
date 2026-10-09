import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RestoreState } from "@kickrocks/shared";
import type { Clock } from "./clock.js";
import type { Logger } from "./logger.js";

/** Left in the data directory by `install.sh --restore`, and removed once sending may resume. */
export const RESTORE_MARKER = "restored-at";

/** How long to wait before looking in the Sent folders again after a check that could not finish. */
export const RESTORE_RETRY_MS = 5 * 60 * 1000;

/**
 * Holds every send after a restore. The restored database does not know about mail sent after the
 * backup was taken, so a request that looks unsent would be mailed to the broker a second time.
 * The marker is a file in the data directory, not memory, so a restart in the middle of the check
 * does not lift the hold.
 */
export interface RestoreGate {
  holding(): boolean;
  state(): RestoreState;
  /** Whether a check is due now: not before the first, and not again until the retry wait has passed. */
  checkDue(): boolean;
  /** Records that a check ran, and why it could not finish, so the person is told. */
  checked(problem: string | null): void;
  /**
   * Lifts the hold, because every mailbox was checked or a person said to go on. The hold stays
   * until every settler has run, so work that must not start unsettled never gets the chance to.
   */
  release(reason: "checked" | "confirmed"): void;
  /** Registers what has to be done to the work that was queued at the restore before it may start. */
  onRelease(settle: (restoredAt: Date) => void): void;
}

const MAX_DATE_MS = 8.64e15;

type GateDeps = { dataDir: string; clock: Clock; logger: Logger };

export function createRestoreGate({ dataDir, clock, logger }: GateDeps): RestoreGate {
  const marker = join(dataDir, RESTORE_MARKER);
  let problem: string | null = null;
  let lastCheckAt: number | null = null;
  // A marker that cannot be removed must not trap the server in a hold nobody can lift.
  let lifted = false;
  const settlers: Array<(restoredAt: Date) => void> = [];

  const restoredAt = (): string | null => {
    if (lifted) return null;
    try {
      const text = readFileSync(marker, "utf8").trim();
      return text.length > 0 ? text : new Date(0).toISOString();
    } catch {
      return null;
    }
  };

  return {
    holding: () => restoredAt() !== null,
    state() {
      const at = restoredAt();
      return { holding: at !== null, restoredAt: at, problem: at === null ? null : problem };
    },
    checkDue() {
      if (restoredAt() === null) return false;
      return lastCheckAt === null || clock.now().getTime() - lastCheckAt >= RESTORE_RETRY_MS;
    },
    checked(next) {
      lastCheckAt = clock.now().getTime();
      problem = next;
    },
    onRelease(settle) {
      settlers.push(settle);
    },
    release(reason) {
      const at = restoredAt();
      if (at !== null) {
        const stamp = Date.parse(at);
        // A marker with no readable time cannot say which work predates the restore, so all of it does.
        const cutoff = stamp > 0 ? new Date(stamp) : new Date(MAX_DATE_MS);
        for (const settle of settlers) settle(cutoff);
      }
      lifted = true;
      problem = null;
      try {
        rmSync(marker, { force: true });
      } catch (error) {
        logger.warn({ err: error }, "could not remove the restore marker");
      }
      logger.info({ reason }, "sending resumed after a restore");
    },
  };
}
