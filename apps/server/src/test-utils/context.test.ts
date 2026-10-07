import { existsSync } from "node:fs";
import { API_ROUTES, Broker, Company, Recipe } from "@kickrocks/shared";
import { afterEach, describe, expect, it } from "vitest";
import { notFound } from "../core/errors.js";
import { DAY, FakeClock } from "./clock.js";
import {
  createTestContext,
  TEST_MCP_TOKEN,
  TEST_WORKER_TOKEN,
  type TestContext,
} from "./context.js";

let ctx: TestContext | undefined;

afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe("createTestContext", () => {
  it("builds a ready app on a fresh encrypted database with the scheduler off", async () => {
    ctx = await createTestContext();
    expect(ctx.services.config).toMatchObject({
      schedulerEnabled: false,
      env: "test",
      logLevel: "silent",
      workerToken: TEST_WORKER_TOKEN,
      publicUrl: "http://kickrocks.test",
    });
    expect(existsSync(ctx.services.config.dbPath)).toBe(true);
    expect(ctx.app.hasRoute({ method: "GET", url: "/api/health" })).toBe(true);
    expect((await ctx.app.inject({ url: "/api/health" })).statusCode).toBe(200);
  });

  it("starts with no targets or profiles, however many contexts exist", async () => {
    const other = await createTestContext();
    try {
      ctx = await createTestContext();
      expect(ctx.services.db.$client.prepare("select count(*) as n from targets").get()).toEqual({
        n: 0,
      });
      expect(ctx.services.db.$client.prepare("select count(*) as n from profiles").get()).toEqual({
        n: 0,
      });
      expect(ctx.services.config.dataDir).not.toBe(other.services.config.dataDir);
    } finally {
      await other.close();
    }
  });

  it("removes its temporary directory when closed", async () => {
    ctx = await createTestContext();
    const dir = ctx.services.config.dataDir;
    await ctx.close();
    expect(existsSync(dir)).toBe(false);
    ctx = undefined;
  });

  it("uses a fake clock that every service reads", async () => {
    ctx = await createTestContext({ now: "2030-01-02T03:04:05.000Z" });
    expect(ctx.clock).toBeInstanceOf(FakeClock);
    expect(ctx.services.clock.now().toISOString()).toBe("2030-01-02T03:04:05.000Z");
    ctx.clock.advance(DAY);
    expect(ctx.services.clock.now().toISOString()).toBe("2030-01-03T03:04:05.000Z");
  });

  it("wires the fakes in place of mail, legal, and auth", async () => {
    ctx = await createTestContext();
    expect(ctx.services.mail).toBe(ctx.mail.services);
    expect(ctx.services.legal).toBe(ctx.legal);
    expect(ctx.services.auth).toBe(ctx.auth);
  });

  it("enables the worker API and MCP with known tokens", async () => {
    ctx = await createTestContext();
    expect(ctx.workerToken).toBe(TEST_WORKER_TOKEN);
    expect(ctx.mcpToken).toBe(TEST_MCP_TOKEN);
    expect(ctx.services.secrets.checkMcpToken(`Bearer ${TEST_MCP_TOKEN}`)).toBe("ok");
  });

  it("accepts extra environment", async () => {
    ctx = await createTestContext({ env: { KICKROCKS_PUBLIC_URL: "https://other.test" } });
    expect(ctx.services.config.publicUrl).toBe("https://other.test");
  });
});

describe("inject helpers", () => {
  it("sends the CSRF header from inject, the worker token from injectWorker, and the MCP token from injectMcp", async () => {
    const seen: Array<Record<string, unknown>> = [];
    ctx = await createTestContext({
      beforeReady: (app) => {
        app.addHook("onRequest", async (request) => void seen.push(request.headers));
        app.get("/echo", async () => ({}));
      },
    });
    await ctx.inject({ url: "/echo" });
    await ctx.injectWorker({ url: "/echo" });
    await ctx.injectMcp({ url: "/echo" });
    expect(seen[0]?.["x-kick-rocks"]).toBe("1");
    expect(seen[1]?.authorization).toBe(`Bearer ${TEST_WORKER_TOKEN}`);
    expect(seen[2]?.authorization).toBe(`Bearer ${TEST_MCP_TOKEN}`);
  });

  it("serializes an object payload as json", async () => {
    let body: unknown;
    ctx = await createTestContext({
      beforeReady: (app) => {
        app.post("/echo", async (request) => {
          body = request.body;
          return {};
        });
      },
    });
    await ctx.inject({ method: "POST", url: "/echo", payload: { a: 1 } });
    expect(body).toEqual({ a: 1 });
  });
});

describe("call", () => {
  it("parses a successful response through the route's schema", async () => {
    ctx = await createTestContext();
    const result = await ctx.call(API_ROUTES.health);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.version).toBe("test");
  });

  it("returns the error body for a failure", async () => {
    ctx = await createTestContext({
      beforeReady: (app) => {
        app.get("/api/__missing/:id", async () => {
          throw notFound("There is no such thing", "thing_not_found");
        });
      },
    });
    const result = await ctx.call(
      { ...API_ROUTES.profilesGet, path: "/__missing/:id" },
      { params: { id: "x" } },
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      body: { error: "thing_not_found", message: "There is no such thing" },
    });
  });

  it("fails the test when a route answers with a status other than the one the table promises", async () => {
    ctx = await createTestContext({
      beforeReady: (app) => {
        app.post("/api/__create", async () => ({ id: "p", displayName: "x" }));
      },
    });
    // The table says a create answers 201, so a handler that forgets reply.code(201) is a bug.
    await expect(
      ctx.call(
        { ...API_ROUTES.profilesCreate, path: "/__create", response: undefined as never },
        {
          body: {} as never,
        },
      ),
    ).rejects.toThrow(/answered 200, but the route table says 201/);
  });

  it("builds the url from params and query and uses the worker token for worker routes", async () => {
    const urls: string[] = [];
    const auth: Array<string | undefined> = [];
    ctx = await createTestContext({
      beforeReady: (app) => {
        app.addHook("onRequest", async (request) => {
          urls.push(request.url);
          auth.push(request.headers.authorization);
        });
      },
    });
    await ctx.call(API_ROUTES.targetsList, { query: { q: "spo", page: 2 } });
    await ctx.call(API_ROUTES.workerTaskComplete, {
      params: { id: "a/b" },
      body: { workerId: "w", result: {} },
    });
    expect(urls).toEqual(["/api/targets?q=spo&page=2", "/api/worker/tasks/a%2Fb/complete"]);
    expect(auth).toEqual([undefined, `Bearer ${TEST_WORKER_TOKEN}`]);
  });

  it("fails the test when a route breaks its own contract", async () => {
    ctx = await createTestContext({
      beforeReady: (app) => {
        app.get("/api/broken", async () => ({ ok: false }));
      },
    });
    await expect(ctx.call({ ...API_ROUTES.health, path: "/broken" })).rejects.toThrow();
  });
});

describe("builders", () => {
  it("produce valid records with distinct ids and domains", async () => {
    const { makeBroker, makeCompany, makeRecipe } = await import("./builders.js");
    const a = makeBroker();
    const b = makeBroker();
    expect(Broker.safeParse(a).success).toBe(true);
    expect(a.id).not.toBe(b.id);
    expect(a.domain).not.toBe(b.domain);
    expect(Company.safeParse(makeCompany()).success).toBe(true);
    expect(
      Recipe.safeParse(makeRecipe({ brokerId: "x", purpose: "scan", version: 2 })).success,
    ).toBe(true);
    expect(makeRecipe({ brokerId: "x" }).id).toBe("x.remove.v1");
    expect(makeBroker({ id: "spokeo" }).domain).toBe("spokeo.test");
  });
});

describe("auth modes", () => {
  it("lets a test allow or deny every session request with the fake, which is the default", async () => {
    ctx = await createTestContext();
    expect(ctx.services.auth).toBe(ctx.auth);
    ctx.auth.deny();
    expect((await ctx.inject({ url: "/api/status" })).statusCode).toBe(401);
    ctx.auth.allow();
    expect((await ctx.inject({ url: "/api/status" })).statusCode).toBe(200);
  });

  it("runs the server's own auth service when asked, and refuses to be steered", async () => {
    const real = await createTestContext({ auth: "real" });
    ctx = real;
    expect(real.services.auth).not.toBe(real.auth);
    expect(() => real.auth.deny()).toThrow(/auth is real/);
    expect(() => real.auth.allow()).toThrow(/auth is real/);
    // The guard still asks the real service, whatever it answers.
    expect(await real.services.auth.authenticate({} as never)).toBeDefined();
    expect((await real.inject({ url: "/api/health" })).statusCode).toBe(200);
  });
});

describe("csrf option", () => {
  it("sends the X-Kick-Rocks header by default and leaves it out on request", async () => {
    const seen: Array<unknown> = [];
    ctx = await createTestContext({
      beforeReady: (app) => {
        app.addHook(
          "onRequest",
          async (request) => void seen.push(request.headers["x-kick-rocks"]),
        );
        app.get("/echo", async () => ({}));
      },
    });
    await ctx.inject({ url: "/echo" });
    await ctx.inject({ url: "/echo", csrf: false });
    await ctx.injectWorker({ url: "/echo" });
    expect(seen).toEqual(["1", undefined, undefined]);
  });

  it("lets a test see the server turn away a state-changing call that lacks it", async () => {
    ctx = await createTestContext();
    const response = await ctx.inject({
      method: "POST",
      url: "/api/profiles",
      payload: {},
      csrf: false,
    });
    expect(response.statusCode).toBe(403);
  });
});
