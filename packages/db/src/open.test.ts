import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOrCreateKey, openDatabase } from "./open.js";
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
