import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeAuth } from "../test-utils/fake-auth.js";
import { createTestContext, type TestContext } from "../test-utils/index.js";
import { guardFor, registerGuards } from "./guard.js";
import type { Secrets } from "./secrets.js";

describe("guardFor", () => {
  it.each([
    ["/api/health", "none"],
    ["/api/health?verbose=1", "none"],
    ["/api/auth/state", "none"],
    ["/api/auth/login", "none"],
    ["/api/worker/claim", "worker"],
    ["/api/worker/tasks/abc/complete", "worker"],
    ["/api/profiles", "session"],
    ["/api/profiles/abc/mailbox/test", "session"],
    ["/api/targets/facets", "session"],
    ["/api/settings/mcp-token", "session"],
    ["/api/", "session"],
    ["/api/unknown", "session"],
    ["/mcp", "mcp"],
    ["/mcp/", "mcp"],
    ["/mcp?x=1", "mcp"],
    ["/mcp/session", "mcp"],
    ["/", "none"],
    ["/index.html", "none"],
    ["/assets/index-abc.js", "none"],
    ["/profiles/abc", "none"],
  ])("%s needs %s", (url, kind) => {
    expect(guardFor(url)).toBe(kind);
  });

  it.each([
    "/api/auth/../profiles",
    "/api/auth/%2e%2e/profiles",
    "/api/health/../profiles",
    "/api//profiles",
    "//api/profiles",
    "/%61pi/profiles",
    "/api/%70rofiles",
    "/api/worker%2Fclaim",
    "/api/./profiles",
    "http://localhost/api/profiles",
    "/api/profiles#fragment",
    "/api/%E0%A4%A/profiles",
  ])("cannot be used to reach a session route unguarded: %s", (url) => {
    expect(guardFor(url)).toBe("session");
  });

  it.each(["/mcp/../mcp", "//mcp", "/%6dcp", "/mcp%2Fx"])(
    "cannot be used to reach /mcp unguarded: %s",
    (url) => {
      expect(["mcp", "session"]).toContain(guardFor(url));
      expect(guardFor(url)).not.toBe("none");
    },
  );

  it("does not guard a path that only resembles the prefixes", () => {
    expect(guardFor("/apis/profiles")).toBe("none");
    expect(guardFor("/mcp-docs")).toBe("none");
    expect(guardFor("/API/profiles")).toBe("none");
  });
});

describe("registerGuards on a bare app", () => {
  const secrets = {
    checkWorkerToken: () => "ok",
    checkMcpToken: () => "ok",
  } as unknown as Secrets;

  it("keeps a route unreachable through a path trick", async () => {
    const auth = new FakeAuth();
    auth.deny();
    const app = Fastify();
    registerGuards(app, { auth, secrets });
    app.get("/api/profiles", async () => ({ secret: true }));
    app.get("/api/health", async () => ({ ok: true }));
    for (const url of [
      "/api/profiles",
      "/api/auth/../profiles",
      "/api//profiles",
      "/%61pi/profiles",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(401);
      expect(response.body, url).not.toContain("secret");
    }
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    await app.close();
  });
});

describe("guards in the running app", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("asks the auth service about session routes and honors its answer", async () => {
    ctx.auth.deny();
    const denied = await ctx.inject({ url: "/api/profiles" });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toEqual({ error: "unauthorized" });
    ctx.auth.deny(403);
    const forbidden = await ctx.inject({ url: "/api/profiles" });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: "forbidden" });
    ctx.auth.allow();
    expect((await ctx.inject({ url: "/api/profiles" })).statusCode).toBe(501);
  });

  it("leaves health and the auth routes open", async () => {
    ctx.auth.deny();
    expect((await ctx.inject({ url: "/api/health" })).statusCode).toBe(200);
    expect((await ctx.inject({ url: "/api/auth/state" })).statusCode).toBe(501);
  });

  it("passes the auth service's code and message through", async () => {
    ctx.auth.deny(403, { error: "csrf", message: "Missing X-Kick-Rocks header" });
    const response = await ctx.inject({ url: "/api/profiles" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "csrf", message: "Missing X-Kick-Rocks header" });
  });

  it("requires the worker token for worker routes and nothing else will do", async () => {
    const claim = { method: "POST" as const, url: "/api/worker/claim", payload: {} };
    expect((await ctx.app.inject(claim)).statusCode).toBe(401);
    expect(
      (await ctx.app.inject({ ...claim, headers: { authorization: "Bearer wrong" } })).statusCode,
    ).toBe(401);
    expect((await ctx.inject(claim)).statusCode).toBe(401);
    expect((await ctx.injectMcp(claim)).statusCode).toBe(401);
    const missing = await ctx.app.inject(claim);
    expect(missing.headers["www-authenticate"]).toBe("Bearer");
    expect(missing.json()).toMatchObject({ error: "unauthorized" });
    expect((await ctx.injectWorker(claim)).statusCode).toBe(501);
  });

  it("does not let a worker token open session routes", async () => {
    ctx.auth.deny();
    expect((await ctx.injectWorker({ url: "/api/profiles" })).statusCode).toBe(401);
  });

  it("switches the worker API off when no token is configured", async () => {
    const bare = await createTestContext({ env: { KICKROCKS_WORKER_TOKEN: "" } });
    try {
      const response = await bare.app.inject({
        method: "POST",
        url: "/api/worker/claim",
        payload: {},
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: "worker_api_disabled" });
    } finally {
      await bare.close();
    }
  });

  it("requires the MCP token for /mcp", async () => {
    expect((await ctx.app.inject({ method: "POST", url: "/mcp", payload: {} })).statusCode).toBe(
      401,
    );
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/mcp",
          payload: {},
          headers: { authorization: "Bearer nope" },
        })
      ).statusCode,
    ).toBe(401);
    expect((await ctx.injectWorker({ method: "POST", url: "/mcp", payload: {} })).statusCode).toBe(
      401,
    );
    expect((await ctx.injectMcp({ method: "POST", url: "/mcp", payload: {} })).statusCode).toBe(
      501,
    );
  });

  it("answers 503 for /mcp while it is switched off", async () => {
    ctx.services.settings.set("mcp.enabled", false);
    const response = await ctx.injectMcp({ method: "POST", url: "/mcp", payload: {} });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "mcp_disabled" });
  });

  it("picks up a rotated MCP token immediately", async () => {
    const token = ctx.services.secrets.rotateMcpToken();
    expect((await ctx.injectMcp({ method: "POST", url: "/mcp", payload: {} })).statusCode).toBe(
      401,
    );
    const fresh = await ctx.app.inject({
      method: "POST",
      url: "/mcp",
      payload: {},
      headers: { authorization: `Bearer ${token}` },
    });
    expect(fresh.statusCode).toBe(501);
  });
});

const TEST_TOKEN = "test-worker-token-0123456789";
