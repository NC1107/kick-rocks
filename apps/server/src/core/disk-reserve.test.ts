import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { openDatabase } from "@kickrocks/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiskReserve, isDiskFull, RESERVE_BYTES } from "./disk-reserve.js";

const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "kr-reserve-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const full = Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });

describe("disk reserve", () => {
  it("lays the reserve down once and gives it up when a write reports a full disk", () => {
    const dir = scratch();
    const warn = vi.fn();
    const reserve = createDiskReserve(dir, { warn });
    reserve.arm();
    expect(statSync(join(dir, ".disk-reserve")).size).toBe(RESERVE_BYTES);

    reserve.releaseOnFull(new Error("something else"));
    expect(existsSync(join(dir, ".disk-reserve"))).toBe(true);

    reserve.releaseOnFull(new Error("wrapped", { cause: full }));
    expect(existsSync(join(dir, ".disk-reserve"))).toBe(false);
    expect(warn).toHaveBeenCalledOnce();

    reserve.arm();
    expect(existsSync(join(dir, ".disk-reserve"))).toBe(true);
  });

  it("holds bytes that do not compress, so a compressing filesystem really sets the space aside", () => {
    const dir = scratch();
    createDiskReserve(dir, { warn: vi.fn() }).arm();
    const held = readFileSync(join(dir, ".disk-reserve"));
    expect(gzipSync(held).length).toBeGreaterThan(RESERVE_BYTES * 0.95);
  });

  it("lets the write that reports a real full database land once the reserve is given up", () => {
    const dir = scratch();
    const opened = openDatabase({ dbPath: join(dir, "test.db"), keyPath: join(dir, "db.key") });
    const db = opened.db.$client;
    db.exec("create table leases (id integer primary key, holder text)");
    const pageSize = db.pragma("page_size", { simple: true }) as number;
    const pages = db.pragma("page_count", { simple: true }) as number;
    db.pragma(`max_page_count = ${pages + 8}`);
    const insert = db.prepare("insert into leases (holder) values (?)");
    const filler = "x".repeat(pageSize);

    // The reserve's disk space is stood in for by raising the page limit when it is given up.
    const reserve = createDiskReserve(dir, {
      warn: () => db.pragma(`max_page_count = ${pages + 8 + RESERVE_BYTES / pageSize}`),
    });
    reserve.arm();

    let failure: unknown;
    try {
      for (;;) insert.run(filler);
    } catch (error) {
      failure = error;
    }
    expect(isDiskFull(failure)).toBe(true);
    expect(() => insert.run(filler)).toThrow(/full/);

    reserve.releaseOnFull(failure);
    expect(() => insert.run(filler)).not.toThrow();
    opened.close();
  });
});
