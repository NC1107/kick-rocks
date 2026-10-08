import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

const KEY_BYTES = 32;
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

export type KickRocksDb = ReturnType<typeof drizzle<typeof schema>>;

/** What a query needs, so a helper accepts the database and a transaction alike. */
export type DbHandle = Pick<KickRocksDb, "select" | "insert" | "update" | "delete">;

export interface OpenDatabaseOptions {
  dbPath: string;
  keyPath: string;
  /** Only tests point this elsewhere, to stand in for an older or newer build. */
  migrationsFolder?: string;
}

export interface OpenedDatabase {
  db: KickRocksDb;
  close(): void;
}

/**
 * The key is raw bytes rather than a passphrase so SQLCipher skips its KDF and
 * the key file alone is enough to open the database unattended.
 */
export function loadOrCreateKey(keyPath: string): string {
  if (existsSync(keyPath)) {
    const hex = readFileSync(keyPath, "utf8").trim();
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      throw new Error(`Key file ${keyPath} is not a 32-byte hex key`);
    }
    restrictToOwner(keyPath);
    return hex.toLowerCase();
  }
  mkdirSync(dirname(keyPath), { recursive: true });
  const hex = randomBytes(KEY_BYTES).toString("hex");
  writeFileSync(keyPath, `${hex}\n`, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  return hex;
}

/**
 * The key file is the only thing standing between a stolen database and its contents, so a mode
 * that lets other users read it is repaired rather than trusted.
 */
function restrictToOwner(keyPath: string): void {
  if ((statSync(keyPath).mode & 0o077) === 0) return;
  try {
    chmodSync(keyPath, 0o600);
  } catch (error) {
    throw new Error(`Key file ${keyPath} can be read by other users and its mode cannot be fixed`, {
      cause: error,
    });
  }
}

/** A database with a missing key can never be opened again, so a fresh key would only hide that. */
function assertKeyPresentForExistingDatabase(options: OpenDatabaseOptions): void {
  const hasData = existsSync(options.dbPath) && statSync(options.dbPath).size > 0;
  if (hasData && !existsSync(options.keyPath)) {
    throw new Error(
      `Key file missing for an existing database: ${options.dbPath} is encrypted and ${options.keyPath} does not exist. Restore the key file that was backed up with the database.`,
    );
  }
}

interface JournalEntry {
  tag: string;
  when: number;
}

function readJournal(folder: string): JournalEntry[] {
  const journal = JSON.parse(readFileSync(resolve(folder, "meta", "_journal.json"), "utf8"));
  return journal.entries;
}

function lastAppliedMigration(sqlite: Database.Database): number | null {
  const table = sqlite
    .prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
    .get();
  if (!table) return null;
  const row = sqlite.prepare("select max(created_at) as last from __drizzle_migrations").get() as {
    last: number | null;
  };
  return row.last;
}

/**
 * Migrations only move forward, so a database a newer build has already migrated would be read by
 * code that does not know its shape. Pending migrations get a copy first because they cannot be undone.
 */
function guardMigrations(sqlite: Database.Database, options: OpenDatabaseOptions, folder: string) {
  const applied = lastAppliedMigration(sqlite);
  if (applied === null) return;
  const entries = readJournal(folder);
  const newest = entries.at(-1)?.when ?? 0;
  if (applied > newest) {
    sqlite.close();
    throw new Error(
      `${options.dbPath} was migrated by a newer build of Kick Rocks than this one. Update Kick Rocks, or restore a backup made by this version.`,
    );
  }
  const pending = entries.find((entry) => entry.when > applied);
  if (!pending) return;
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  copyFileSync(options.dbPath, `${options.dbPath}.before-${pending.tag}`);
}

export function openDatabase(options: OpenDatabaseOptions): OpenedDatabase {
  assertKeyPresentForExistingDatabase(options);
  const keyHex = loadOrCreateKey(options.keyPath);
  mkdirSync(dirname(options.dbPath), { recursive: true });
  const sqlite = new Database(options.dbPath);
  sqlite.pragma("cipher='sqlcipher'");
  sqlite.pragma("legacy=4");
  sqlite.pragma(`key="x'${keyHex}'"`);
  try {
    sqlite.prepare("select count(*) from sqlite_master").get();
  } catch (error) {
    sqlite.close();
    throw new Error(`Could not open ${options.dbPath}; wrong key or corrupt file`, {
      cause: error,
    });
  }
  // Sort spills and temporary tables would otherwise land in temp files, which are not encrypted.
  sqlite.pragma("temp_store = MEMORY");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  const folder = options.migrationsFolder ?? migrationsFolder;
  guardMigrations(sqlite, options, folder);
  migrate(db, { migrationsFolder: folder });
  return {
    db,
    close: () => sqlite.close(),
  };
}
