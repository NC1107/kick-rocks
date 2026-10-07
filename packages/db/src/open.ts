import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

const KEY_BYTES = 32;
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

export type KickRocksDb = ReturnType<typeof drizzle<typeof schema>>;

export interface OpenDatabaseOptions {
  dbPath: string;
  keyPath: string;
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
    return hex.toLowerCase();
  }
  mkdirSync(dirname(keyPath), { recursive: true });
  const hex = randomBytes(KEY_BYTES).toString("hex");
  writeFileSync(keyPath, `${hex}\n`, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  return hex;
}

export function openDatabase(options: OpenDatabaseOptions): OpenedDatabase {
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
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return {
    db,
    close: () => sqlite.close(),
  };
}
