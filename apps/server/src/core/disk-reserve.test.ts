import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiskReserve, RESERVE_BYTES } from "./disk-reserve.js";

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
});
