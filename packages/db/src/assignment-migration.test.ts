import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const FULL = resolve(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
const NOW = "2026-10-07T00:00:00.000Z";

let dir: string;
let sqlite: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kickrocks-migration-"));
  sqlite = new Database(join(dir, "kickrocks.db"));
  sqlite.pragma("foreign_keys = ON");
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The migrations as they were before this one, so a database can be built the way it was in the field. */
function migrationsBefore(tag: string): string {
  const folder = join(dir, "before");
  cpSync(FULL, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  const cut = journal.entries.findIndex((entry) => entry.tag === tag);
  journal.entries = journal.entries.slice(0, cut);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

describe("0012_task_assignment and 0013_claimer_last_claim", () => {
  it("upgrades a database at the 0011 schema, keeps its tasks unassigned, and drops the retired worker status settings", () => {
    migrate(drizzle(sqlite), { migrationsFolder: migrationsBefore("0012_task_assignment") });
    sqlite
      .prepare(
        "INSERT INTO profiles (id, display_name, state, created_at, updated_at) VALUES ('p1', 'Jordan', 'TX', ?, ?)",
      )
      .run(NOW, NOW);
    const setting = sqlite.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
    );
    setting.run("worker.status.builtin", "{}", NOW);
    setting.run("worker.status.model", "{}", NOW);
    setting.run("quiet.hours", "{}", NOW);

    migrate(drizzle(sqlite), { migrationsFolder: FULL });

    expect(sqlite.prepare("SELECT key FROM settings ORDER BY key").all()).toEqual([
      { key: "quiet.hours" },
    ]);
    const tasks = sqlite.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    expect(tasks.map((column) => column.name)).toContain("assignment");
    const claimers = sqlite.prepare("PRAGMA table_info(claimers)").all() as Array<{ name: string }>;
    expect(claimers.map((column) => column.name)).toEqual(
      expect.arrayContaining(["kind", "worker_id", "last_claim_at"]),
    );
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM profiles").get()).toEqual({ n: 1 });
  });
});
