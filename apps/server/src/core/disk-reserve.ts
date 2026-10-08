import { randomFillSync } from "node:crypto";
import { closeSync, openSync, rmSync, statfsSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";

/**
 * Enough for the lease, status and error writes a few polls and sends need, which are what keep
 * the person informed and the mail moving once the disk has run out.
 */
export const RESERVE_BYTES = 8 * 1024 * 1024;

/** The reserve is only laid down where the disk keeps room for itself afterwards. */
const SPARE_BYTES = 2 * RESERVE_BYTES;

/** Random, because zeros take almost no real space on a compressing filesystem such as btrfs or ZFS. */
const CHUNK = randomFillSync(Buffer.alloc(1024 * 1024));

/** SQLite reports a full disk as SQLITE_FULL, which the query layer may wrap in an error of its own. */
export function isDiskFull(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth += 1) {
    if ((current as { code?: unknown }).code === "SQLITE_FULL") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface DiskReserve {
  /** Lays the reserve down if it is missing and the disk has room for it. */
  arm(): void;
  /** Gives the reserve back when `error` is a full disk, so the writes that report the fault can land. */
  releaseOnFull(error: unknown): void;
}

/**
 * A file of incompressible bytes that is deleted when the disk fills. SQLite needs a little room even to
 * record that it has none, and without it a full disk also stops polls, leases and the error
 * shown to the person, not only the writes that filled it.
 */
export function createDiskReserve(
  dataDir: string,
  logger: { warn(message: string): void },
): DiskReserve {
  const path = join(dataDir, ".disk-reserve");
  const present = (): boolean => {
    try {
      return statSync(path).size > 0;
    } catch {
      return false;
    }
  };
  return {
    arm() {
      if (present()) return;
      try {
        const { bavail, bsize } = statfsSync(dataDir);
        if (Number(bavail) * Number(bsize) < RESERVE_BYTES + SPARE_BYTES) return;
        const fd = openSync(path, "w");
        try {
          for (let written = 0; written < RESERVE_BYTES; written += CHUNK.length) {
            writeSync(fd, CHUNK);
          }
        } finally {
          closeSync(fd);
        }
      } catch {
        rmSync(path, { force: true });
      }
    },
    releaseOnFull(error) {
      if (!isDiskFull(error) || !present()) return;
      rmSync(path, { force: true });
      logger.warn("the disk is full, so the space held back for it was given up");
    },
  };
}
