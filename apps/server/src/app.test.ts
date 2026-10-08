import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  jordanIdentities,
  seedTarget,
  type TestContext,
} from "./test-utils/index.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

describe("GET /api/health", () => {
  const health = () => ctx.app.inject({ method: "GET", url: "/api/health" });

  it("says whether the server can do its job, to anyone", async () => {
    ctx.auth.deny();
    const response = await health();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      version: "test",
      scheduler: { lastPassAt: null },
      database: { writable: true },
    });
    expect(response.json().disk.freeBytes).toBeGreaterThan(0);
  });

  it("does not reveal how many profiles or targets the instance has", async () => {
    seedTarget(ctx, { id: "a" });
    const body = (await health()).json();
    expect(Object.keys(body).sort()).toEqual(["database", "disk", "ok", "scheduler", "version"]);
  });

  it("leaves no row behind from its write probe", async () => {
    await health();
    expect(
      ctx.services.db.$client
        .prepare("SELECT count(*) AS n FROM settings WHERE key = 'health.probe'")
        .get(),
    ).toEqual({ n: 0 });
  });

  it("reports the scheduler's last finished pass", async () => {
    ctx.services.liveness.expectScheduler();
    ctx.services.liveness.markPass();
    expect((await health()).json().scheduler.lastPassAt).toBe(ctx.clock.now().toISOString());
  });

  it("fails once the scheduler has not finished a pass in five minutes", async () => {
    ctx.services.liveness.expectScheduler();
    ctx.services.liveness.markPass();
    ctx.clock.advance(4 * 60_000);
    expect((await health()).statusCode).toBe(200);
    ctx.clock.advance(61_000);
    const response = await health();
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ ok: false, database: { writable: true } });
  });

  it("fails when a scheduler that never finished a pass has been running for five minutes", async () => {
    ctx.services.liveness.expectScheduler();
    ctx.clock.advance(6 * 60_000);
    expect((await health()).statusCode).toBe(503);
  });

  it("fails when the database cannot take a write", async () => {
    ctx.services.db.$client.exec(
      "CREATE TEMP TRIGGER refuse BEFORE INSERT ON settings BEGIN SELECT RAISE(ABORT, 'refused'); END",
    );
    const response = await health();
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ ok: false, database: { writable: false } });
  });
});

describe("a write when the disk is full", () => {
  it("answers 507 with a message that names the disk, not a bare 500", async () => {
    const { $client } = ctx.services.db;
    $client.pragma(`max_page_count = ${$client.pragma("page_count", { simple: true })}`);
    $client.exec("CREATE TABLE filler (blob BLOB)");
    // Taking up every page the file may still grow by is what a nearly full disk looks like to SQLite.
    for (const size of [16384, 512, 8]) {
      expect(() => {
        for (;;) $client.exec(`INSERT INTO filler VALUES (zeroblob(${size}))`);
      }).toThrow(/full/);
    }
    const create = () =>
      ctx.inject({
        method: "POST",
        url: "/api/profiles",
        payload: { displayName: "Jordan Example", state: "TX", identities: jordanIdentities() },
      });
    // The last pages of a full file still take small writes, so the writes go on until one cannot fit.
    let response = await create();
    for (let attempt = 0; attempt < 200 && response.statusCode === 201; attempt += 1) {
      response = await create();
    }
    expect(response.statusCode).toBe(507);
    expect(response.json()).toMatchObject({ error: "disk_full" });
    expect(response.json().message).toContain("disk");
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
