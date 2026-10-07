import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, seedTarget, type TestContext } from "./test-utils/index.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

describe("GET /api/health", () => {
  it("reports status, version, and counts without a session", async () => {
    ctx.auth.deny();
    const response = await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      version: "test",
      profiles: 0,
      brokers: { available: false, total: 0 },
      targets: { brokers: 0, companies: 0 },
    });
  });

  it("counts targets that are not retired", async () => {
    seedTarget(ctx, { id: "a" });
    seedTarget(ctx, { kind: "company", id: "b" });
    const body = (await ctx.app.inject({ method: "GET", url: "/api/health" })).json();
    expect(body.brokers).toEqual({ available: true, total: 1 });
    expect(body.targets).toEqual({ brokers: 1, companies: 1 });
  });
});

describe("unknown routes", () => {
  it("answer with json 404 under /api and /mcp for an authorized caller", async () => {
    for (const response of [
      await ctx.inject({ url: "/api/nope" }),
      await ctx.injectMcp({ url: "/mcp/nope" }),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "not_found" });
    }
  });

  it("answer 404 json elsewhere when there is no web build", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/anything" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
  });
});
