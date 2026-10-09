import { removeStalePreMigrationCopies } from "@kickrocks/db";
import type { AppServices } from "../services.js";
import { lastVerifiedBackup } from "./health.js";

/** Long enough to notice a migration that went wrong, short enough that a second full database does not linger. */
export const MIGRATION_COPY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Drops the rollback copy of the database once a verified backup or its age makes it dead weight. */
export function removeStaleMigrationCopies({
  db,
  config,
  clock,
  logger,
}: Pick<AppServices, "db" | "config" | "clock" | "logger">): number {
  const backedUpAt = lastVerifiedBackup(config.dataDir);
  const removed = removeStalePreMigrationCopies(db.$client.name, {
    now: clock.now(),
    verifiedBackupAt: backedUpAt ? new Date(backedUpAt) : null,
    maxAgeMs: MIGRATION_COPY_MAX_AGE_MS,
  });
  if (removed > 0) logger.info({ removed }, "removed a stale pre-migration database copy");
  return removed;
}
