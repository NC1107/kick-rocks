# Backup, restore and upgrade drill

`pnpm loop:backup-drill` prints a JSON result.
`score` is the number of failing items, lower is better, and `targetMet` is true only at 0.
`pnpm loop:backup-drill --no-docker` runs the migration ladder alone, with no Docker.

## What it checks

- The ladder opens a database at each older migration, seeds every table, upgrades it through the real `openDatabase`, and counts rows that changed or vanished and `PRAGMA foreign_key_check` violations.
  The rungs follow `packages/db/drizzle/meta/_journal.json`, so a new migration adds a rung with no edit here.
- The ladder also checks that a database from a newer build is refused and that a copy is kept before pending migrations run.
- The drill builds the stack under two scratch compose projects named `loop-backup-drill-*` on ports the OS picks.
  It seeds one instance, runs `./install.sh --backup`, restores into the other, and diffs every table against a raw copy of the source volume.
- Negative cases: a truncated archive, an archive whose key does not open its database, an archive with a damaged database, and a backup that fails halfway over a good file.
  A bad archive must be refused and leave the data volume byte for byte as it was.
- Features still to build are probed through the interface the harness expects: `--backup FILE --passphrase-file PATH`, `--restore FILE --passphrase-file PATH`, `--schedule-backup DIR --once --keep N`, and a `health.backup` field in `/api/status`.

## Safety

Archives hold the database key.
They live in a scratch folder with mode 600 and are deleted when the run ends, together with the scratch containers, volumes and images.
The drill works on a copy of the checkout, so it never writes a `.env` or a backup into the repository.
