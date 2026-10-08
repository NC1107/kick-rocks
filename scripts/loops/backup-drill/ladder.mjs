import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..", "..", "..");
const dbPackage = join(root, "packages", "db");
const drizzleFolder = join(dbPackage, "drizzle");
const require = createRequire(join(dbPackage, "package.json"));

const KEY = "0123456789abcdef".repeat(4);
const ROWS_PER_TABLE = 3;
const HOUSEKEEPING = /^(sqlite_|__drizzle)/;
const DATA_FILES = /^(kickrocks\.db(-wal|-shm)?|db\.key)$/;

function openRaw(dataDir) {
  const Database = require("better-sqlite3");
  const sqlite = new Database(join(dataDir, "kickrocks.db"));
  sqlite.pragma("cipher='sqlcipher'");
  sqlite.pragma("legacy=4");
  sqlite.pragma(`key="x'${KEY}'"`);
  return sqlite;
}

function journal() {
  return JSON.parse(readFileSync(join(drizzleFolder, "meta", "_journal.json"), "utf8"));
}

// Drizzle applies whatever the folder's journal lists, so a rung is a copy of the folder cut short.
function migrationsUpTo(count, scratch) {
  const folder = join(scratch, `upto-${count}`);
  mkdirSync(join(folder, "meta"), { recursive: true });
  const full = journal();
  const entries = full.entries.slice(0, count);
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ ...full, entries }));
  for (const entry of entries) {
    cpSync(join(drizzleFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

function migrateTo(sqlite, folder) {
  const { drizzle } = require("drizzle-orm/better-sqlite3");
  const { migrate } = require("drizzle-orm/better-sqlite3/migrator");
  migrate(drizzle(sqlite), { migrationsFolder: folder });
}

function userTables(sqlite) {
  return sqlite
    .prepare("select name from sqlite_master where type = 'table'")
    .all()
    .map((row) => row.name)
    .filter((name) => !HOUSEKEEPING.test(name));
}

function parentsFirst(sqlite, tables) {
  const parents = new Map(
    tables.map((table) => [
      table,
      new Set(
        sqlite
          .pragma(`foreign_key_list(\`${table}\`)`)
          .map((fk) => fk.table)
          .filter((parent) => parent !== table),
      ),
    ]),
  );
  const ordered = [];
  const pending = new Set(tables);
  while (pending.size > 0) {
    const ready = [...pending].filter((table) =>
      [...parents.get(table)].every((p) => !pending.has(p)),
    );
    for (const table of ready.length > 0 ? ready : [...pending]) {
      ordered.push(table);
      pending.delete(table);
    }
  }
  return ordered;
}

function valueFor(table, column, i) {
  if (/int/i.test(column.type)) return i + 1;
  if (/real|floa|doub/i.test(column.type)) return i + 0.5;
  if (/blob/i.test(column.type)) return Buffer.from(`${table}-${column.name}-${i}`);
  return `${table}-${column.name}-${i}`;
}

// Every column gets a distinct value, so a column a table rebuild drops or reorders shows up as a changed row.
function seed(sqlite) {
  sqlite.pragma("foreign_keys = OFF");
  const written = new Map();
  for (const table of parentsFirst(sqlite, userTables(sqlite))) {
    const columns = sqlite
      .pragma(`table_xinfo(\`${table}\`)`)
      .filter((column) => column.hidden === 0);
    const foreignKeys = sqlite.pragma(`foreign_key_list(\`${table}\`)`);
    const rows = [];
    for (let i = 0; i < ROWS_PER_TABLE; i++) {
      const row = {};
      for (const column of columns) {
        const fk = foreignKeys.find((candidate) => candidate.from === column.name);
        const parentRows = fk && fk.table !== table ? written.get(fk.table) : null;
        if (parentRows?.length) row[column.name] = parentRows[i % parentRows.length][fk.to ?? "id"];
        else if (fk && column.notnull === 0) row[column.name] = null;
        else row[column.name] = valueFor(table, column, i);
      }
      const names = Object.keys(row);
      const quoted = names.map((name) => `\`${name}\``).join(",");
      const marks = names.map(() => "?").join(",");
      sqlite
        .prepare(`insert into \`${table}\` (${quoted}) values (${marks})`)
        .run(...Object.values(row));
      rows.push(row);
    }
    written.set(table, rows);
  }
}

function snapshot(sqlite) {
  const out = {};
  for (const table of userTables(sqlite)) {
    const columns = sqlite.pragma(`table_info(\`${table}\`)`).map((column) => column.name);
    out[table] = { columns, rows: sqlite.prepare(`select * from \`${table}\``).all() };
  }
  return out;
}

// Rows are compared on the columns both schemas have, so a column a migration adds is not a difference.
function compare(before, after) {
  let mismatched = 0;
  let rowsChecked = 0;
  const lostTables = [];
  const rowCountDiff = {};
  for (const [table, old] of Object.entries(before)) {
    const next = after[table];
    if (!next) {
      lostTables.push(table);
      mismatched += old.rows.length;
      continue;
    }
    rowsChecked += old.rows.length;
    const shared = old.columns.filter((column) => next.columns.includes(column));
    const key = (row) =>
      JSON.stringify(
        shared.map((column) =>
          Buffer.isBuffer(row[column]) ? row[column].toString("hex") : row[column],
        ),
      );
    const available = new Map();
    for (const row of next.rows) available.set(key(row), (available.get(key(row)) ?? 0) + 1);
    for (const row of old.rows) {
      const left = available.get(key(row)) ?? 0;
      if (left === 0) mismatched++;
      else available.set(key(row), left - 1);
    }
    if (old.rows.length !== next.rows.length)
      rowCountDiff[table] = next.rows.length - old.rows.length;
  }
  return { rowsChecked, mismatched, lostTables, rowCountDiff };
}

async function openHead(dataDir) {
  const { openDatabase } = await import(pathToFileURL(join(dbPackage, "dist", "index.js")).href);
  return openDatabase({ dbPath: join(dataDir, "kickrocks.db"), keyPath: join(dataDir, "db.key") });
}

function freshDataDir(scratch, name) {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "db.key"), `${KEY}\n`, { mode: 0o600 });
  return dir;
}

async function rung(scratch, from, head) {
  const tag = journal().entries[from - 1].tag;
  const dir = freshDataDir(scratch, `from-${from}`);
  const old = openRaw(dir);
  migrateTo(old, migrationsUpTo(from, scratch));
  seed(old);
  const seedViolations = old.pragma("foreign_key_check").length;
  const before = snapshot(old);
  old.close();
  try {
    (await openHead(dir)).close();
  } catch (error) {
    return { from: tag, to: head, error: String(error?.message ?? error) };
  }
  const after = openRaw(dir);
  after.pragma("foreign_keys = ON");
  const result = {
    from: tag,
    to: head,
    seedViolations,
    foreignKeyViolations: after.pragma("foreign_key_check").length,
    ...compare(before, snapshot(after)),
    leftoverFiles: readdirSync(dir).filter((file) => !DATA_FILES.test(file)),
  };
  after.close();
  return result;
}

async function newerSchemaRefused(scratch) {
  const dir = freshDataDir(scratch, "newer");
  (await openHead(dir)).close();
  const sqlite = openRaw(dir);
  sqlite
    .prepare("insert into __drizzle_migrations (hash, created_at) values (?, ?)")
    .run("from-the-future", 9_999_999_999_999);
  sqlite.close();
  try {
    (await openHead(dir)).close();
    return false;
  } catch {
    return true;
  }
}

/** Every user table of the database in a data directory, opened with that directory's own key. */
export function readDatabase(dataDir) {
  const Database = require("better-sqlite3");
  const sqlite = new Database(join(dataDir, "kickrocks.db"), { readonly: true });
  sqlite.pragma("cipher='sqlcipher'");
  sqlite.pragma("legacy=4");
  sqlite.pragma(`key="x'${readFileSync(join(dataDir, "db.key"), "utf8").trim()}'"`);
  try {
    return snapshot(sqlite);
  } finally {
    sqlite.close();
  }
}

export { compare as compareSnapshots };

export async function runLadder() {
  const scratch = mkdtempSync(join(tmpdir(), "loop-backup-drill-ladder-"));
  try {
    const entries = journal().entries;
    const head = entries.at(-1).tag;
    const rungs = [];
    for (let from = 1; from < entries.length; from++) rungs.push(await rung(scratch, from, head));
    const failing = rungs
      .filter(
        (r) =>
          r.error ||
          r.mismatched > 0 ||
          r.foreignKeyViolations > 0 ||
          r.seedViolations > 0 ||
          r.lostTables.length > 0,
      )
      .map((r) => `ladder: ${r.from} to ${r.to}`);
    const newerRefused = await newerSchemaRefused(scratch);
    if (!newerRefused) failing.push("a database from a newer build is opened instead of refused");
    const copyKept = (rungs[0]?.leftoverFiles?.length ?? 0) > 0;
    if (!copyKept) failing.push("no copy of the database is kept before pending migrations run");
    return { head, rungs, newerRefused, copyKeptBeforeMigrate: copyKept, failing };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
