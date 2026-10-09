import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadOrCreateKey,
  openDatabase,
  removePreMigrationCopies,
  removeStalePreMigrationCopies,
  type StaleCopyPolicy,
} from "./open.js";
import { profiles } from "./schema.js";

let dir: string;

const NOW = "2026-10-07T00:00:00.000Z";

function profile(id: string, displayName: string, state: "TX" | "CA") {
  return { id, displayName, state, createdAt: NOW, updatedAt: NOW };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kickrocks-db-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadOrCreateKey", () => {
  it("creates an owner-only 32-byte key and reuses it", () => {
    const keyPath = join(dir, "db.key");
    const first = loadOrCreateKey(keyPath);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(loadOrCreateKey(keyPath)).toBe(first);
    expect(readFileSync(keyPath, "utf8").trim()).toBe(first);
  });

  it("rejects a malformed key file", () => {
    const keyPath = join(dir, "db.key");
    writeFileSync(keyPath, "not-a-key\n");
    expect(() => loadOrCreateKey(keyPath)).toThrow(/not a 32-byte hex key/);
  });

  it("takes access away from other users when it loads a key they could read", () => {
    const keyPath = join(dir, "db.key");
    loadOrCreateKey(keyPath);
    chmodSync(keyPath, 0o644);
    loadOrCreateKey(keyPath);
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
  });
});

describe("openDatabase", () => {
  it("migrates, persists, and reopens with the same key", () => {
    const dbPath = join(dir, "kickrocks.db");
    const keyPath = join(dir, "db.key");
    const first = openDatabase({ dbPath, keyPath });
    first.db
      .insert(profiles)
      .values(profile("p1", "Nick", "TX"))
      .run();
    first.close();

    const second = openDatabase({ dbPath, keyPath });
    const rows = second.db.select().from(profiles).all();
    second.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "p1", displayName: "Nick", state: "TX" });
  });

  it("refuses to open with a different key", () => {
    const dbPath = join(dir, "kickrocks.db");
    const opened = openDatabase({ dbPath, keyPath: join(dir, "a.key") });
    opened.close();
    loadOrCreateKey(join(dir, "b.key"));
    expect(() => openDatabase({ dbPath, keyPath: join(dir, "b.key") })).toThrow(
      /wrong key or corrupt file/,
    );
  });

  it("does not invent a new key for a database whose key file is gone", () => {
    const dbPath = join(dir, "kickrocks.db");
    const keyPath = join(dir, "db.key");
    openDatabase({ dbPath, keyPath }).close();
    rmSync(keyPath);
    expect(() => openDatabase({ dbPath, keyPath })).toThrow(
      /Key file missing for an existing database/,
    );
    expect(() => statSync(keyPath)).toThrow();
  });

  it("keeps temporary tables and sort spills in memory, where they are never written to disk", () => {
    const opened = openDatabase({
      dbPath: join(dir, "kickrocks.db"),
      keyPath: join(dir, "db.key"),
    });
    // 2 is MEMORY; the bundled build would otherwise use temp files, which are not encrypted.
    expect(opened.db.$client.pragma("temp_store", { simple: true })).toBe(2);
    opened.close();
  });

  it("stores no plaintext on disk", () => {
    const dbPath = join(dir, "kickrocks.db");
    const opened = openDatabase({ dbPath, keyPath: join(dir, "db.key") });
    opened.db
      .insert(profiles)
      .values(profile("p1", "PLAINTEXT-MARKER", "CA"))
      .run();
    opened.close();
    const bytes = readFileSync(dbPath);
    expect(bytes.includes("PLAINTEXT-MARKER")).toBe(false);
    expect(bytes.subarray(0, 15).toString("latin1")).not.toBe("SQLite format 3");
  });
});

describe("openDatabase across builds", () => {
  const drizzleFolder = resolve(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

  function foldersCutAt(count: number): string {
    const folder = join(dir, `migrations-${count}`);
    mkdirSync(join(folder, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(drizzleFolder, "meta", "_journal.json"), "utf8"));
    const entries = journal.entries.slice(0, count);
    writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) {
      cpSync(join(drizzleFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    }
    return folder;
  }

  const paths = () => ({ dbPath: join(dir, "kickrocks.db"), keyPath: join(dir, "db.key") });
  const copies = () => readdirSync(dir).filter((file) => file.includes(".before-"));

  it("refuses a database that a newer build migrated, and leaves it alone", () => {
    openDatabase(paths()).close();
    const bytes = readFileSync(paths().dbPath);
    expect(() => openDatabase({ ...paths(), migrationsFolder: foldersCutAt(2) })).toThrow(
      /newer build/,
    );
    expect(readFileSync(paths().dbPath).equals(bytes)).toBe(true);
  });

  it("opens a database that a branch migrated with the task_sends migration under an earlier timestamp", () => {
    const folder = join(dir, "migrations-branch");
    mkdirSync(join(folder, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(drizzleFolder, "meta", "_journal.json"), "utf8"));
    const shared = journal.entries.slice(0, 7);
    const branchEntry = {
      ...journal.entries[10],
      idx: 7,
      when: 1791476590826,
      tag: "0007_task_sends",
    };
    writeFileSync(
      join(folder, "meta", "_journal.json"),
      JSON.stringify({ ...journal, entries: [...shared, branchEntry] }),
    );
    for (const entry of shared) {
      cpSync(join(drizzleFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    }
    cpSync(join(drizzleFolder, "0010_task_sends.sql"), join(folder, "0007_task_sends.sql"));
    openDatabase({ ...paths(), migrationsFolder: folder }).close();

    const opened = openDatabase(paths());
    const rows = opened.db.$client
      .prepare("select created_at as createdAt from __drizzle_migrations order by created_at")
      .all() as { createdAt: number }[];
    expect(rows.map((row) => row.createdAt)).toEqual(
      journal.entries.map((entry: { when: number }) => entry.when),
    );
    expect(
      opened.db.$client
        .prepare(
          "select count(*) as n from pragma_table_info('outgoing_mail') where name = 'recipient'",
        )
        .get(),
    ).toEqual({ n: 1 });
    opened.close();
    openDatabase(paths()).close();
  });

  it("keeps a copy of the database before pending migrations run", () => {
    const older = openDatabase({ ...paths(), migrationsFolder: foldersCutAt(2) });
    older.db
      .insert(profiles)
      .values(profile("p1", "Nick", "TX"))
      .run();
    older.close();
    expect(copies()).toEqual([]);
    openDatabase(paths()).close();
    const [copy] = copies();
    expect(copy).toMatch(/^kickrocks\.db\.before-0002_/);
    expect(existsSync(join(dir, copy as string))).toBe(true);
    const old = openDatabase({
      dbPath: join(dir, copy as string),
      keyPath: paths().keyPath,
      migrationsFolder: foldersCutAt(2),
    });
    expect(old.db.select().from(profiles).all()).toHaveLength(1);
    old.close();
  });

  it("keeps only the newest copy, and no partial file", () => {
    openDatabase({ ...paths(), migrationsFolder: foldersCutAt(1) }).close();
    openDatabase({ ...paths(), migrationsFolder: foldersCutAt(2) }).close();
    expect(copies()).toHaveLength(1);
    openDatabase(paths()).close();
    const left = copies();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/^kickrocks\.db\.before-0002_/);
    expect(left.some((file) => file.endsWith(".partial"))).toBe(false);
  });

  it("removes every copy on request", () => {
    openDatabase({ ...paths(), migrationsFolder: foldersCutAt(2) }).close();
    openDatabase(paths()).close();
    expect(copies()).toHaveLength(1);
    removePreMigrationCopies(paths().dbPath);
    expect(copies()).toEqual([]);
    expect(existsSync(paths().dbPath)).toBe(true);
  });

  describe("removing a stale copy", () => {
    const madeAt = new Date("2026-10-01T00:00:00Z");
    const day = 24 * 60 * 60 * 1000;

    function copyMadeAt(when: Date) {
      openDatabase({ ...paths(), migrationsFolder: foldersCutAt(2) }).close();
      openDatabase(paths()).close();
      const [copy] = copies();
      utimesSync(join(dir, copy as string), when, when);
    }

    const policy = (over: Partial<StaleCopyPolicy>): StaleCopyPolicy => ({
      now: new Date(madeAt.getTime() + day),
      verifiedBackupAt: null,
      maxAgeMs: 14 * day,
      ...over,
    });

    it("keeps a young copy that no backup has replaced", () => {
      copyMadeAt(madeAt);
      expect(removeStalePreMigrationCopies(paths().dbPath, policy({}))).toBe(0);
      expect(copies()).toHaveLength(1);
    });

    it("removes the copy once a verified backup is newer than the migration", () => {
      copyMadeAt(madeAt);
      const backup = new Date(madeAt.getTime() + 1000);
      expect(
        removeStalePreMigrationCopies(paths().dbPath, policy({ verifiedBackupAt: backup })),
      ).toBe(1);
      expect(copies()).toEqual([]);
    });

    it("keeps the copy when the only backup is older than the migration", () => {
      copyMadeAt(madeAt);
      const backup = new Date(madeAt.getTime() - day);
      expect(
        removeStalePreMigrationCopies(paths().dbPath, policy({ verifiedBackupAt: backup })),
      ).toBe(0);
    });

    it("removes the copy after the fixed age even with no backup", () => {
      copyMadeAt(madeAt);
      const later = new Date(madeAt.getTime() + 15 * day);
      expect(removeStalePreMigrationCopies(paths().dbPath, policy({ now: later }))).toBe(1);
      expect(existsSync(paths().dbPath)).toBe(true);
    });
  });

  it("makes no copy when nothing is pending", () => {
    openDatabase(paths()).close();
    openDatabase(paths()).close();
    expect(copies()).toEqual([]);
  });
});
