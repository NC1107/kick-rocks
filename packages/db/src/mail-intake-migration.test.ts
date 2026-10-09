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

function seed(): void {
  sqlite
    .prepare(
      "INSERT INTO profiles (id, display_name, state, created_at, updated_at) VALUES (?, 'Jordan', 'TX', ?, ?)",
    )
    .run("p1", NOW, NOW);
  sqlite
    .prepare(
      "INSERT INTO profiles (id, display_name, state, created_at, updated_at) VALUES (?, 'Sam', 'CA', ?, ?)",
    )
    .run("p2", NOW, NOW);
  const mailbox = sqlite.prepare(
    `INSERT INTO mailboxes (id, profile_id, provider, address, username, secret, smtp_host, smtp_port,
       smtp_secure, imap_host, imap_port, daily_cap, created_at)
     VALUES (?, ?, 'other', ?, ?, 's', 'smtp.example.test', 587, 0, 'imap.example.test', 993, 30, ?)`,
  );
  mailbox.run("m-with", "p1", "a@example.com", "a@example.com", NOW);
  mailbox.run("m-without", "p2", "b@example.com", "b@example.com", NOW);
  sqlite
    .prepare(
      `INSERT INTO messages (id, mailbox_id, imap_uid, uid_validity, from_address, subject, received_at,
         classification, confidence, links, created_at)
       VALUES ('msg-1', 'm-with', 1, 1, 'x@y.test', 'Hello', ?, 'unrelated', 0.7, '[]', ?)`,
    )
    .run(NOW, NOW);
}

describe("0011_mail_intake", () => {
  it("marks only the mailboxes that hold stored mail for the one-time cleanup, and keeps their data", () => {
    migrate(drizzle(sqlite), { migrationsFolder: migrationsBefore("0011_mail_intake") });
    seed();

    migrate(drizzle(sqlite), { migrationsFolder: FULL });

    const rows = sqlite
      .prepare(
        `SELECT id, company_mail, reply_alias, reply_alias_verified_at, last_poll_scanned,
                last_poll_kept, intake_cleanup, intake_cleanup_removed, intake_cleanup_at
         FROM mailboxes ORDER BY id`,
      )
      .all();
    expect(rows).toEqual([
      {
        id: "m-with",
        company_mail: "privacy_only",
        reply_alias: null,
        reply_alias_verified_at: null,
        last_poll_scanned: 0,
        last_poll_kept: 0,
        intake_cleanup: "pending",
        intake_cleanup_removed: null,
        intake_cleanup_at: null,
      },
      {
        id: "m-without",
        company_mail: "privacy_only",
        reply_alias: null,
        reply_alias_verified_at: null,
        last_poll_scanned: 0,
        last_poll_kept: 0,
        intake_cleanup: "done",
        intake_cleanup_removed: null,
        intake_cleanup_at: null,
      },
    ]);
    expect(sqlite.prepare("SELECT admitted_by, subject FROM messages").all()).toEqual([
      { admitted_by: null, subject: "Hello" },
    ]);
  });

  it("creates the table of senders to always take in, unique per mailbox and value", () => {
    migrate(drizzle(sqlite), { migrationsFolder: FULL });
    const columns = sqlite.prepare("PRAGMA table_info(intake_senders)").all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "mailbox_id",
      "target_id",
      "kind",
      "value",
      "created_at",
    ]);
    const indexes = sqlite.prepare("PRAGMA index_list(intake_senders)").all() as Array<{
      name: string;
      unique: number;
    }>;
    expect(indexes).toContainEqual(
      expect.objectContaining({ name: "intake_senders_value_idx", unique: 1 }),
    );
  });

  it("opens a week of the passed-over report for every mailbox that existed, and keeps their data", () => {
    migrate(drizzle(sqlite), { migrationsFolder: migrationsBefore("0011_mail_intake") });
    seed();
    const before = Date.now();

    migrate(drizzle(sqlite), { migrationsFolder: FULL });

    const rows = sqlite
      .prepare(
        "SELECT id, intake_cleanup, intake_shadow_until, intake_shadow_dismissed_at FROM mailboxes ORDER BY id",
      )
      .all() as Array<{
      id: string;
      intake_cleanup: string;
      intake_shadow_until: string;
      intake_shadow_dismissed_at: string | null;
    }>;
    expect(rows.map((row) => [row.id, row.intake_cleanup, row.intake_shadow_dismissed_at])).toEqual(
      [
        ["m-with", "pending", null],
        ["m-without", "done", null],
      ],
    );
    for (const row of rows) {
      const until = Date.parse(row.intake_shadow_until);
      expect(until - before).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
      expect(until - before).toBeLessThan(7.1 * 24 * 60 * 60 * 1000);
    }
    expect(sqlite.prepare("SELECT subject, cleanup_candidate FROM messages").all()).toEqual([
      { subject: "Hello", cleanup_candidate: 0 },
    ]);
    const mailboxColumns = sqlite.prepare("PRAGMA table_info(mailboxes)").all() as Array<{
      name: string;
    }>;
    expect(mailboxColumns.map((column) => column.name)).not.toContain("intake_notice_seen_at");
  });

  it("creates the ignored list and the passed-over list, each tied to its mailbox", () => {
    migrate(drizzle(sqlite), { migrationsFolder: FULL });
    for (const table of ["ignored_messages", "intake_shadow"]) {
      const keys = sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
        table: string;
        on_delete: string;
      }>;
      expect(keys).toContainEqual(
        expect.objectContaining({ table: "mailboxes", on_delete: "CASCADE" }),
      );
    }
    const indexes = sqlite.prepare("PRAGMA index_list(intake_shadow)").all() as Array<{
      name: string;
      unique: number;
    }>;
    expect(indexes).toContainEqual(
      expect.objectContaining({ name: "intake_shadow_uid_idx", unique: 1 }),
    );
  });
});
