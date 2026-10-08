import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContext, type TestContext } from "../test-utils/index.js";
import { DISK_FLOOR_BYTES } from "./health.js";

const free = vi.hoisted(() => ({ bytes: null as number | null }));

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    statfsSync: (...args: Parameters<typeof original.statfsSync>) => {
      const real = original.statfsSync(...args);
      return free.bytes === null ? real : { ...real, bavail: free.bytes, bsize: 1 };
    },
  };
});

let ctx: TestContext;

beforeEach(async () => {
  free.bytes = null;
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

const health = () => ctx.app.inject({ method: "GET", url: "/api/health" });
const status = async () =>
  (await ctx.inject({ method: "GET", url: "/api/status" })).json().health.disk;

describe("free disk space", () => {
  it("passes while there is room", async () => {
    expect((await health()).statusCode).toBe(200);
    expect((await status()).low).toBe(false);
  });

  it("fails below the floor even though a small write still fits", async () => {
    free.bytes = DISK_FLOOR_BYTES - 1;
    expect((await health()).statusCode).toBe(503);
    expect(await status()).toEqual({ freeBytes: DISK_FLOOR_BYTES - 1, low: true });
  });

  it("passes at the floor", async () => {
    free.bytes = DISK_FLOOR_BYTES;
    expect((await health()).statusCode).toBe(200);
  });
});
