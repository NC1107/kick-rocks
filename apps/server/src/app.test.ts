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
  it("says only that the server is up, to anyone", async () => {
    ctx.auth.deny();
    const response = await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, version: "test" });
  });

  it("does not reveal how many profiles or targets the instance has", async () => {
    seedTarget(ctx, { id: "a" });
    const body = (await ctx.app.inject({ method: "GET", url: "/api/health" })).json();
    expect(Object.keys(body).sort()).toEqual(["ok", "version"]);
  });
});

describe("GET /api/status", () => {
  it("reports what the instance holds, to a signed-in caller only", async () => {
    ctx.auth.deny();
    expect((await ctx.inject({ url: "/api/status" })).statusCode).toBe(401);
    ctx.auth.allow();
    const response = await ctx.inject({ url: "/api/status" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      profiles: 0,
      brokers: { available: false, total: 0 },
      targets: { brokers: 0, companies: 0 },
    });
  });

  it("counts targets that are not retired", async () => {
    seedTarget(ctx, { id: "a" });
    seedTarget(ctx, { kind: "company", id: "b" });
    const body = (await ctx.inject({ url: "/api/status" })).json();
    expect(body.brokers).toEqual({ available: true, total: 1 });
    expect(body.targets).toEqual({ brokers: 1, companies: 1 });
  });
});

describe("security headers", () => {
  it("go on every response, the JSON API and a 404 alike", async () => {
    for (const response of [
      await ctx.app.inject({ url: "/api/health" }),
      await ctx.inject({ url: "/api/nope" }),
      await ctx.app.inject({ url: "/anything" }),
    ]) {
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["x-frame-options"]).toBe("DENY");
      const csp = String(response.headers["content-security-policy"]);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
    }
  });

  it("go on an error answered before any route runs", async () => {
    const response = await ctx.app.inject({ method: "POST", url: "/api/profiles", payload: {} });
    expect(response.statusCode).toBe(403);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("framework errors", () => {
  it("answer a malformed URL in the API error shape with the security headers", async () => {
    const response = await ctx.app.inject({ url: "/%c0" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_request",
      message: "The request could not be processed",
    });
    expect(response.body).not.toContain("FST_ERR");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(String(response.headers["content-security-policy"])).toContain("default-src 'self'");
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
