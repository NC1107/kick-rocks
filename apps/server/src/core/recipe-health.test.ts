import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SECOND } from "../test-utils/clock.js";
import {
  createTestContext,
  seedRecipe,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { BROKEN_AFTER_FAILURES } from "./recipe-health.js";

let ctx: TestContext;
let recipeId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  recipeId = seedRecipe(ctx, seedTarget(ctx).id).id;
});

afterEach(async () => {
  await ctx.close();
});

describe("recordRun", () => {
  it("marks a recipe healthy after a success and clears the failure count", () => {
    ctx.services.recipeHealth.recordRun(recipeId, { ok: false });
    const row = ctx.services.recipeHealth.recordRun(recipeId, { ok: true });
    expect(row).toMatchObject({
      health: "healthy",
      failureCount: 0,
      lastCheckedAt: ctx.clock.now().toISOString(),
    });
  });

  it("counts failures and leaves the health alone until the limit", () => {
    for (let i = 1; i < BROKEN_AFTER_FAILURES; i++) {
      expect(ctx.services.recipeHealth.recordRun(recipeId, { ok: false })).toMatchObject({
        health: "unknown",
        failureCount: i,
      });
    }
    expect(ctx.services.recipeHealth.recordRun(recipeId, { ok: false })).toMatchObject({
      health: "broken",
      failureCount: BROKEN_AFTER_FAILURES,
    });
  });

  it("keeps a healthy recipe healthy through isolated failures", () => {
    ctx.services.recipeHealth.recordRun(recipeId, { ok: true });
    expect(ctx.services.recipeHealth.recordRun(recipeId, { ok: false })).toMatchObject({
      health: "healthy",
      failureCount: 1,
    });
  });

  it("recovers from broken on the next success", () => {
    for (let i = 0; i < BROKEN_AFTER_FAILURES; i++)
      ctx.services.recipeHealth.recordRun(recipeId, { ok: false });
    expect(ctx.services.recipeHealth.recordRun(recipeId, { ok: true })).toMatchObject({
      health: "healthy",
      failureCount: 0,
    });
  });

  it("stamps the check time from the clock", () => {
    ctx.clock.advance(5 * SECOND);
    expect(ctx.services.recipeHealth.recordRun(recipeId, { ok: true }).lastCheckedAt).toBe(
      ctx.clock.now().toISOString(),
    );
  });
});

describe("recordCanary", () => {
  it("breaks a recipe at once when a selector is missing", () => {
    expect(ctx.services.recipeHealth.recordCanary(recipeId, { healthy: false })).toMatchObject({
      health: "broken",
      failureCount: 1,
    });
  });

  it("heals a recipe when every selector is found", () => {
    ctx.services.recipeHealth.recordCanary(recipeId, { healthy: false });
    expect(ctx.services.recipeHealth.recordCanary(recipeId, { healthy: true })).toMatchObject({
      health: "healthy",
      failureCount: 0,
    });
  });
});

describe("unknown recipes", () => {
  it("throws a 404", () => {
    expect(() => ctx.services.recipeHealth.recordRun("missing", { ok: true })).toThrow(
      /Recipe missing not found/,
    );
    expect(() => ctx.services.recipeHealth.recordCanary("missing", { healthy: true })).toThrow(
      /not found/,
    );
  });
});
