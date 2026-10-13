import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const FULL = resolve(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

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

describe("0018_match_assessment", () => {
  it("upgrades a database at the 0017 schema and leaves its matches unscored", () => {
    migrate(drizzle(sqlite), { migrationsFolder: migrationsBefore("0018_match_assessment") });
    const columns = () =>
      (sqlite.prepare("PRAGMA table_info(matches)").all() as Array<{ name: string }>).map(
        (column) => column.name,
      );
    expect(columns()).not.toContain("assessment");

    migrate(drizzle(sqlite), { migrationsFolder: FULL });

    expect(columns()).toContain("assessment");
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM matches WHERE assessment IS NOT NULL").get(),
    ).toEqual({ n: 0 });
  });
});
