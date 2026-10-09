import { type KickRocksDb, removePreMigrationCopies } from "@kickrocks/db";

/**
 * Deleting rows only moves their pages to the free list, where the old bytes stay readable to
 * anyone holding the key. VACUUM rewrites the file without them, and the checkpoint folds the
 * write-ahead log back in so the log does not keep a copy either.
 *

 * The copies kept before a migration are removed too, because they still hold what was deleted.
 *
 * It cannot run inside a transaction, so callers commit their deletes first.
 */
export function compactDatabase(db: KickRocksDb): void {
  db.$client.exec("VACUUM");
  db.$client.pragma("wal_checkpoint(TRUNCATE)");
  removePreMigrationCopies(db.$client.name);
}
