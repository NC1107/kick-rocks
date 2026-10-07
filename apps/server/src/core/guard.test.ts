import { API_ROUTES } from "@kickrocks/shared";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeAuth } from "../test-utils/fake-auth.js";
import { createTestContext, type TestContext } from "../test-utils/index.js";
import { guardFor, isApiPath, registerGuards } from "./guard.js";
import { registerRoute } from "./http.js";
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
    registerGuards(app, { auth, secrets }, () => true);
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

describe("isApiPath", () => {
  it.each([
    "/api",
    "/api/",
    "/api/profiles",
    "/api//profiles",
    "/%61pi/profiles",
    "/api/auth/../profiles",
    "http://localhost/api/profiles",
  ])("reads %s as under /api", (url) => {
    expect(isApiPath(url)).toBe(true);
  });

  it.each(["/", "/index.html", "/apis/x", "/API/profiles", "/mcp", "/profiles/abc"])(
    "does not read %s as under /api",
    (url) => {
      expect(isApiPath(url)).toBe(false);
    },
  );
});

/**
 * The foundation answers 501 for a route whose module is not built, and a built module answers
 * something else, so these tests ask only whether the guard let a request through or turned it
 * away. The probe routes are registered the way a module might register an ad hoc route, with no
 * declaration, which is the case the path rule has to cover.
 */
describe("guards in the running app", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({
      beforeReady: (app) => {
        const ok = async () => ({ probe: true });
        app.get("/api/__probe", ok);
        app.post("/api/__probe", ok);
        app.get("/api/auth/__probe", ok);
        app.post("/api/auth/__probe", ok);
        app.post("/api/worker/__probe", ok);
      },
    });
  });
  afterEach(async () => {
    await ctx.close();
  });

  const REJECTED = [401, 403, 503];
  const reached = (status: number) => expect(REJECTED).not.toContain(status);

  it("asks the auth service about session routes and honors its answer", async () => {
    ctx.auth.deny();
    const denied = await ctx.inject({ url: "/api/__probe" });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toEqual({ error: "unauthorized" });
    ctx.auth.deny(403);
    const forbidden = await ctx.inject({ url: "/api/__probe" });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: "forbidden" });
    ctx.auth.allow();
    reached((await ctx.inject({ url: "/api/__probe" })).statusCode);
  });

  it("leaves health and the auth routes open", async () => {
    ctx.auth.deny();
    expect((await ctx.inject({ url: "/api/health" })).statusCode).toBe(200);
    reached((await ctx.inject({ url: "/api/auth/state" })).statusCode);
    reached((await ctx.inject({ url: "/api/auth/__probe" })).statusCode);
  });

  it("passes the auth service's code and message through", async () => {
    ctx.auth.deny(403, { error: "locked", message: "Unlock the instance first" });
    const response = await ctx.inject({ url: "/api/__probe" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "locked", message: "Unlock the instance first" });
  });

  it("requires the worker token for worker routes and nothing else will do", async () => {
    const claim = { method: "POST" as const, url: "/api/worker/__probe", payload: {} };
    expect((await ctx.app.inject(claim)).statusCode).toBe(401);
    expect(
      (await ctx.app.inject({ ...claim, headers: { authorization: "Bearer wrong" } })).statusCode,
    ).toBe(401);
    expect((await ctx.inject(claim)).statusCode).toBe(401);
    expect((await ctx.injectMcp(claim)).statusCode).toBe(401);
    const missing = await ctx.app.inject(claim);
    expect(missing.headers["www-authenticate"]).toBe("Bearer");
    expect(missing.json()).toMatchObject({ error: "unauthorized" });
    reached((await ctx.injectWorker(claim)).statusCode);
  });

  it("does not let a worker token open session routes", async () => {
    ctx.auth.deny();
    expect((await ctx.injectWorker({ url: "/api/__probe" })).statusCode).toBe(401);
  });

  it("switches the worker API off when no token is configured", async () => {
    const bare = await createTestContext({
      env: { KICKROCKS_WORKER_TOKEN: "" },
      beforeReady: (app) => {
        app.post("/api/worker/__probe", async () => ({}));
      },
    });
    try {
      const response = await bare.app.inject({
        method: "POST",
        url: "/api/worker/__probe",
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
    const call = (headers?: Record<string, string>) =>
      ctx.app.inject({ method: "POST", url: "/mcp", payload: {}, ...(headers ? { headers } : {}) });
    expect((await call()).statusCode).toBe(401);
    expect((await call({ authorization: "Bearer nope" })).statusCode).toBe(401);
    expect((await ctx.injectWorker({ method: "POST", url: "/mcp", payload: {} })).statusCode).toBe(
      401,
    );
    expect([401, 503]).not.toContain(
      (await ctx.injectMcp({ method: "POST", url: "/mcp", payload: {} })).statusCode,
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
    expect([401, 503]).not.toContain(fresh.statusCode);
  });
});

describe("the route table decides who may call a route", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("asks for a session on /api/auth/password, which the shared table marks as session", async () => {
    ctx.auth.deny();
    const response = await ctx.inject({
      method: "POST",
      url: API_PATHS.authPassword,
      payload: { currentPassword: "x", newPassword: "y".repeat(12) },
    });
    expect(response.statusCode).toBe(401);
  });

  it("leaves the other /api/auth routes open to a caller with no session", async () => {
    ctx.auth.deny();
    for (const route of [
      API_ROUTES.authState,
      API_ROUTES.authSetup,
      API_ROUTES.authLogin,
      API_ROUTES.authLogout,
    ]) {
      const response = await ctx.inject({
        method: route.method,
        url: `/api${route.path}`,
        payload: route.method === "GET" ? undefined : {},
      });
      expect([401, 403], `${route.method} ${route.path}`).not.toContain(response.statusCode);
    }
  });

  it("asks for a session on a route the table marks as session even where its path alone would be open", async () => {
    const declared = await createTestContext({
      beforeReady: (app) => {
        registerRoute(
          app,
          { ...API_ROUTES.authPassword, path: "/api/auth/__declared" },
          () => ({}) as never,
        );
        app.get("/api/auth/__undeclared", async () => ({}));
      },
    });
    try {
      declared.auth.deny();
      expect(guardFor("/api/auth/__declared")).toBe("none");
      const response = await declared.inject({
        method: "POST",
        url: "/api/auth/__declared",
        payload: {},
      });
      expect(response.statusCode).toBe(401);
      // The same path with no declaration is judged by its path, which opens /api/auth.
      expect((await declared.inject({ url: "/api/auth/__undeclared" })).statusCode).toBe(200);
    } finally {
      await declared.close();
    }
  });

  it("applies the session rule to an /api route nobody declared", async () => {
    const undeclared = await createTestContext({
      beforeReady: (app) => {
        app.get("/api/__undeclared", async () => ({}));
      },
    });
    try {
      undeclared.auth.deny();
      expect((await undeclared.inject({ url: "/api/__undeclared" })).statusCode).toBe(401);
    } finally {
      await undeclared.close();
    }
  });

  it("lets a route declared as open stay open even where the path alone would ask for a session", async () => {
    const open = await createTestContext({
      beforeReady: (app) => {
        registerRoute(app, { ...API_ROUTES.authState, path: "/api/__open" }, () => ({}) as never);
      },
    });
    try {
      open.auth.deny();
      expect((await open.inject({ url: "/api/__open" })).statusCode).not.toBe(401);
    } finally {
      await open.close();
    }
  });
});

describe("the X-Kick-Rocks header", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({
      beforeReady: (app) => {
        const ok = async () => ({ probe: true });
        app.post("/api/__probe", ok);
        app.get("/api/__probe", ok);
        app.put("/api/__probe", ok);
        app.delete("/api/__probe", ok);
        app.post("/api/auth/__probe", ok);
        app.post("/api/worker/__probe", ok);
      },
    });
  });
  afterEach(async () => {
    await ctx.close();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "is required on a %s to a session route, with a session",
    async (method) => {
      const without = await ctx.inject({ method, url: "/api/profiles", payload: {}, csrf: false });
      expect(without.statusCode).toBe(403);
      expect(without.json()).toMatchObject({ error: "forbidden" });
      expect(without.json().message).toContain("x-kick-rocks");
    },
  );

  it("is required on the auth routes, which no session protects yet", async () => {
    for (const url of [
      "/api/auth/login",
      "/api/auth/setup",
      "/api/auth/logout",
      "/api/auth/__probe",
    ]) {
      const without = await ctx.inject({ method: "POST", url, payload: {}, csrf: false });
      expect(without.statusCode, url).toBe(403);
      const withHeader = await ctx.inject({ method: "POST", url, payload: {} });
      expect(withHeader.statusCode, url).not.toBe(403);
    }
  });

  it("is checked after the session, so an anonymous caller is told to sign in", async () => {
    ctx.auth.deny();
    const response = await ctx.inject({
      method: "POST",
      url: "/api/__probe",
      payload: {},
      csrf: false,
    });
    expect(response.statusCode).toBe(401);
  });

  it("is not required on a read", async () => {
    for (const method of ["GET", "HEAD"] as const) {
      const response = await ctx.inject({ method, url: "/api/__probe", csrf: false });
      expect(response.statusCode, method).toBe(200);
    }
  });

  it("stops a cross-site form post as text/plain before any handler or body parser sees it", async () => {
    let handled = false;
    const open = await createTestContext({
      beforeReady: (app) => {
        app.post("/api/__form", async () => {
          handled = true;
          return {};
        });
      },
    });
    try {
      const response = await open.inject({
        method: "POST",
        url: "/api/__form",
        headers: { "content-type": "text/plain" },
        payload: '{"anything":"goes"}',
        csrf: false,
      });
      expect(response.statusCode).toBe(403);
      expect(handled).toBe(false);
    } finally {
      await open.close();
    }
  });

  it("is not asked of a worker or the MCP client, who send a bearer token a browser never attaches", async () => {
    const worker = await ctx.injectWorker({
      method: "POST",
      url: "/api/worker/__probe",
      payload: {},
    });
    expect(worker.statusCode).toBe(200);
    const mcp = await ctx.injectMcp({ method: "POST", url: "/mcp", payload: {} });
    expect([401, 403, 503]).not.toContain(mcp.statusCode);
  });

  it("is not asked of a path outside /api, so the web app's files are served as usual", async () => {
    const response = await ctx.app.inject({ method: "POST", url: "/anything", payload: {} });
    expect(response.statusCode).toBe(404);
  });
});

const API_PATHS = { authPassword: `/api${API_ROUTES.authPassword.path}` };

const TEST_TOKEN = "test-worker-token-0123456789";
