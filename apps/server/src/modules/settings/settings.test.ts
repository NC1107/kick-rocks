import { settings, targets } from "@kickrocks/db";
import { API_ROUTES, DataSourceId } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  makeBroker,
  makeCompany,
  type TestContext,
} from "../../test-utils/index.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

const DEFAULT_SCHEDULE = {
  pollMinutes: 15,
  peopleSearchRescanDays: 60,
  brokerRescanDays: 90,
  noResponseDays: 45,
  maxFollowUps: 2,
};

const patch = (body: Record<string, unknown>) =>
  ctx.call(API_ROUTES.settingsPatch, { body: body as never });

describe("the agent worker's reach", () => {
  it("keeps unreviewed sites from the agent worker until the person allows them", async () => {
    const before = await ctx.call(API_ROUTES.settingsGet);
    expect(before.ok && before.body.agent.takeUnreviewed).toBe(false);

    const on = await patch({ agent: { takeUnreviewed: true } });
    expect(on.ok && on.body.agent.takeUnreviewed).toBe(true);
    expect(ctx.services.settings.get("agent.takeUnreviewed")).toBe(true);

    const off = await patch({ agent: { takeUnreviewed: false } });
    expect(off.ok && off.body.agent.takeUnreviewed).toBe(false);
  });

  it("rejects a value that is not a boolean, and leaves other settings alone when it changes", async () => {
    expect((await patch({ agent: { takeUnreviewed: "yes" } })).status).toBe(400);
    await patch({ agent: { takeUnreviewed: true } });
    const view = await ctx.call(API_ROUTES.settingsGet);
    expect(view.ok && view.body.schedule.pollMinutes).toBe(15);
  });
});

describe("access", () => {
  it("turns away an anonymous caller from every route", async () => {
    ctx.auth.deny();
    for (const route of [
      API_ROUTES.settingsGet,
      API_ROUTES.settingsPatch,
      API_ROUTES.settingsMcpToken,
      API_ROUTES.settingsJurisdictions,
      API_ROUTES.settingsDataSources,
    ]) {
      expect((await ctx.call(route, { body: {} as never })).status, route.path).toBe(401);
    }
  });
});

describe("GET /settings", () => {
  it("reports defaults on a fresh instance", async () => {
    const result = await ctx.call(API_ROUTES.settingsGet);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      schedule: DEFAULT_SCHEDULE,
      llm: null,
      mcp: { url: "http://kickrocks.test/mcp" },
      siteChecks: { enabled: false },
      worker: { enabled: true, builtin: null, model: null },
    });
  });

  it("turns site checks on and off, and rejects a value that is not a boolean", async () => {
    const on = await patch({ siteChecks: { enabled: true } });
    expect(on.ok && on.body.siteChecks).toEqual({ enabled: true });
    expect(ctx.services.settings.get("siteChecks.enabled")).toBe(true);
    const off = await patch({ siteChecks: { enabled: false } });
    expect(off.ok && off.body.siteChecks).toEqual({ enabled: false });
    expect((await patch({ siteChecks: { enabled: "yes" } })).status).toBe(400);
  });

  it("says the worker API is off when no worker token is configured", async () => {
    await ctx.close();
    ctx = await createTestContext({ env: { KICKROCKS_WORKER_TOKEN: "" } });
    const result = await ctx.call(API_ROUTES.settingsGet);
    expect(result.ok && result.body.worker.enabled).toBe(false);
  });

  it("passes each kind of worker's last report through, apart", async () => {
    const status = (workerId: string) => ({
      workerId,
      version: "0.1.0",
      lastSeenAt: ctx.clock.now().toISOString(),
      busy: true,
      currentTaskId: "task-1",
    });
    ctx.services.settings.set("worker.status.builtin", status("recipes"));
    let result = await ctx.call(API_ROUTES.settingsGet);
    expect(result.ok && result.body.worker).toMatchObject({
      builtin: status("recipes"),
      model: null,
    });
    ctx.services.settings.set("worker.status.model", status("model"));
    result = await ctx.call(API_ROUTES.settingsGet);
    expect(result.ok && result.body.worker).toMatchObject({
      builtin: status("recipes"),
      model: status("model"),
    });
  });

  it("never includes the LLM key, the MCP token hash, or the password hash", async () => {
    await patch({
      llm: { baseUrl: "http://localhost:11434/v1", model: "llama", apiKey: "sk-secret" },
    });
    await ctx.call(API_ROUTES.settingsMcpToken);
    ctx.services.settings.set("auth.passwordHash", "$argon2id$stored");
    const result = await ctx.call(API_ROUTES.settingsGet);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.response.json());
    expect(text).not.toContain("sk-secret");
    expect(text).not.toContain("argon2id");
    expect(text).not.toContain(ctx.services.settings.get("mcp.tokenHash") as string);
    expect(result.body.llm).toEqual({
      baseUrl: "http://localhost:11434/v1",
      model: "llama",
      apiKeySet: true,
    });
  });

  it("builds the MCP url from the public URL without doubling slashes", async () => {
    await ctx.close();
    ctx = await createTestContext({ env: { KICKROCKS_PUBLIC_URL: "https://kr.example.org/" } });
    const result = await ctx.call(API_ROUTES.settingsGet);
    expect(result.ok && result.body.mcp.url).toBe("https://kr.example.org/mcp");
  });
});

describe("PATCH /settings schedule", () => {
  it("changes only the fields sent", async () => {
    const result = await patch({ schedule: { pollMinutes: 5, maxFollowUps: 0 } });
    expect(result.ok && result.body.schedule).toEqual({
      ...DEFAULT_SCHEDULE,
      pollMinutes: 5,
      maxFollowUps: 0,
    });
    const next = await patch({ schedule: { noResponseDays: 30 } });
    expect(next.ok && next.body.schedule).toEqual({
      ...DEFAULT_SCHEDULE,
      pollMinutes: 5,
      maxFollowUps: 0,
      noResponseDays: 30,
    });
    expect(ctx.services.settings.get("schedule").pollMinutes).toBe(5);
  });

  it("accepts the bounds and rejects values outside them", async () => {
    expect(
      (await patch({ schedule: { pollMinutes: 1, brokerRescanDays: 365, maxFollowUps: 10 } })).ok,
    ).toBe(true);
    const bad = [
      { pollMinutes: 0 },
      { pollMinutes: 1441 },
      { pollMinutes: 1.5 },
      { peopleSearchRescanDays: 0 },
      { brokerRescanDays: 366 },
      { noResponseDays: -1 },
      { maxFollowUps: 11 },
      { maxFollowUps: "2" },
    ];
    for (const schedule of bad) {
      const result = await patch({ schedule });
      expect(result.status, JSON.stringify(schedule)).toBe(400);
      if (!result.ok) {
        expect(result.body.issues?.[0]?.path.slice(0, 2)).toEqual(["body", "schedule"]);
      }
    }
    expect(ctx.services.settings.get("schedule").pollMinutes).toBe(1);
  });

  it("answers with the unchanged settings for an empty patch", async () => {
    const result = await patch({});
    expect(result.ok && result.body.schedule).toEqual(DEFAULT_SCHEDULE);
  });

  it("applies nothing when a later part of the patch is invalid", async () => {
    const result = await patch({
      schedule: { pollMinutes: 5 },
      llm: { baseUrl: "ftp://x", model: "m" },
    });
    expect(result.status).toBe(400);
    expect(ctx.services.settings.get("schedule").pollMinutes).toBe(15);
  });
});

describe("PATCH /settings llm", () => {
  const llm = { baseUrl: "http://localhost:11434/v1", model: "llama3" };

  it("stores the endpoint and reports only whether a key is set", async () => {
    const result = await patch({ llm: { ...llm, apiKey: "sk-test-key" } });
    expect(result.ok && result.body.llm).toEqual({ ...llm, apiKeySet: true });
    expect(ctx.services.settings.get("llm")).toEqual({ ...llm, apiKey: "sk-test-key" });
  });

  it("works without a key, as Ollama does", async () => {
    const result = await patch({ llm });
    expect(result.ok && result.body.llm).toEqual({ ...llm, apiKeySet: false });
    expect(ctx.services.settings.get("llm")?.apiKey).toBeNull();
  });

  it("keeps the stored key when the patch leaves it out", async () => {
    await patch({ llm: { ...llm, apiKey: "sk-test-key" } });
    const result = await patch({ llm: { ...llm, model: "qwen" } });
    expect(result.ok && result.body.llm).toEqual({ ...llm, model: "qwen", apiKeySet: true });
    expect(ctx.services.settings.get("llm")?.apiKey).toBe("sk-test-key");
  });

  it("does not hand the stored key to a different server", async () => {
    await patch({ llm: { ...llm, apiKey: "sk-test-key" } });
    const result = await patch({
      llm: { baseUrl: "https://api.other.example/v1", model: "m" },
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      body: { issues: [{ path: ["body", "llm", "apiKey"] }] },
    });
    expect(ctx.services.settings.get("llm")).toEqual({ ...llm, apiKey: "sk-test-key" });
  });

  it("keeps the stored key when only the path of the endpoint changes", async () => {
    await patch({ llm: { ...llm, apiKey: "sk-test-key" } });
    const result = await patch({ llm: { baseUrl: "http://localhost:11434/other", model: "m" } });
    expect(result.ok).toBe(true);
    expect(ctx.services.settings.get("llm")?.apiKey).toBe("sk-test-key");
  });

  it("accepts a new endpoint with a new key", async () => {
    await patch({ llm: { ...llm, apiKey: "sk-test-key" } });
    await patch({ llm: { baseUrl: "https://api.other.example/v1", model: "m", apiKey: "sk-new" } });
    expect(ctx.services.settings.get("llm")?.apiKey).toBe("sk-new");
  });

  it("removes the key when it is sent as null, and replaces it when a new one is sent", async () => {
    await patch({ llm: { ...llm, apiKey: "sk-one" } });
    await patch({ llm: { ...llm, apiKey: "sk-two" } });
    expect(ctx.services.settings.get("llm")?.apiKey).toBe("sk-two");
    const cleared = await patch({ llm: { ...llm, apiKey: null } });
    expect(cleared.ok && cleared.body.llm?.apiKeySet).toBe(false);
  });

  it("removes the whole LLM configuration with null, key included", async () => {
    await patch({ llm: { ...llm, apiKey: "sk-test-key" } });
    const result = await patch({ llm: null });
    expect(result.ok && result.body.llm).toBeNull();
    expect(
      ctx.services.db
        .select()
        .from(settings)
        .all()
        .map((row) => row.key),
    ).not.toContain("llm");
    const again = await patch({ llm });
    expect(again.ok && again.body.llm?.apiKeySet).toBe(false);
  });

  it("leaves the LLM alone when the patch does not mention it", async () => {
    await patch({ llm });
    const result = await patch({ schedule: { pollMinutes: 20 } });
    expect(result.ok && result.body.llm).toEqual({ ...llm, apiKeySet: false });
  });

  it("rejects a non-http url, a missing model, and an empty key", async () => {
    for (const bad of [
      { baseUrl: "javascript:alert(1)", model: "m" },
      { baseUrl: "file:///etc/passwd", model: "m" },
      { baseUrl: "not a url", model: "m" },
      { baseUrl: llm.baseUrl, model: "" },
      { baseUrl: llm.baseUrl },
      { ...llm, apiKey: "" },
    ]) {
      const result = await patch({ llm: bad });
      expect(result.status, JSON.stringify(bad)).toBe(400);
    }
    expect(ctx.services.settings.get("llm")).toBeNull();
  });
});

describe("MCP settings", () => {
  it("starts disabled with no token in a real instance", async () => {
    await ctx.close();
    ctx = await createTestContext();
    ctx.services.settings.reset("mcp.enabled");
    ctx.services.settings.reset("mcp.tokenHash");
    const result = await ctx.call(API_ROUTES.settingsGet);
    expect(result.ok && result.body.mcp).toMatchObject({ enabled: false, tokenSet: false });
  });

  it("turns the endpoint on and off, and a client is let in only while it is on", async () => {
    const { token } = await rotate();
    expect((await patch({ mcp: { enabled: false } })).ok).toBe(true);
    expect((await mcpWith(token)).statusCode).toBe(503);

    const on = await patch({ mcp: { enabled: true } });
    expect(on.ok && on.body.mcp).toMatchObject({ enabled: true, tokenSet: true });
    expect((await mcpWith(token)).statusCode).not.toBe(401);
    expect((await mcpWith(token)).statusCode).not.toBe(503);
  });

  it("rejects an enabled flag that is not a boolean", async () => {
    expect((await patch({ mcp: { enabled: "yes" } })).status).toBe(400);
    expect((await patch({ mcp: {} })).status).toBe(400);
  });

  async function rotate(): Promise<{ token: string }> {
    const result = await ctx.call(API_ROUTES.settingsMcpToken);
    if (!result.ok) throw new Error("rotation failed");
    return result.body;
  }

  function mcpWith(token: string) {
    return ctx.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {},
    });
  }

  it("returns a new token once and stores only its hash", async () => {
    const { token } = await rotate();
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const stored = ctx.services.settings.get("mcp.tokenHash");
    expect(stored).toBe(ctx.services.secrets.hashToken(token));
    expect(stored).not.toBe(token);

    const rows = ctx.services.db.select().from(settings).all();
    expect(JSON.stringify(rows)).not.toContain(token);
    const view = await ctx.call(API_ROUTES.settingsGet);
    expect(JSON.stringify(view.ok && view.response.json())).not.toContain(token);
    expect(view.ok && view.body.mcp.tokenSet).toBe(true);
  });

  it("sends the token with no-store so no cache keeps it", async () => {
    const result = await ctx.call(API_ROUTES.settingsMcpToken);
    expect(result.response.headers["cache-control"]).toBe("no-store");
  });

  it("makes a different token each time, and the old one stops working at once", async () => {
    const first = await rotate();
    const second = await rotate();
    expect(second.token).not.toBe(first.token);
    expect(ctx.services.secrets.checkMcpToken(`Bearer ${first.token}`)).toBe("invalid");
    expect(ctx.services.secrets.checkMcpToken(`Bearer ${second.token}`)).toBe("ok");
  });

  it("does not switch the endpoint on by rotating a token", async () => {
    await patch({ mcp: { enabled: false } });
    const { token } = await rotate();
    expect(ctx.services.secrets.checkMcpToken(`Bearer ${token}`)).toBe("disabled");
  });

  it("needs the CSRF header like any state-changing call", async () => {
    const response = await ctx.inject({
      method: "POST",
      url: "/api/settings/mcp-token",
      csrf: false,
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("GET /settings/jurisdictions", () => {
  it("passes through what the legal package knows", async () => {
    const result = await ctx.call(API_ROUTES.settingsJurisdictions);
    expect(result.ok && result.body.jurisdictions.map((j) => j.state)).toEqual(["CA", "TX"]);
    expect(result.ok && result.body.jurisdictions[0]?.statutes[0]?.id).toBe("ca-test-act");
  });
});

describe("GET /settings/data-sources", () => {
  it("lists every source with zero counts when no targets are loaded", async () => {
    const result = await ctx.call(API_ROUTES.settingsDataSources);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.sources.map((source) => source.id)).toEqual(DataSourceId.options);
    expect(result.body.sources.every((source) => source.targetCount === 0)).toBe(true);
    const badbool = result.body.sources.find((source) => source.id === "badbool");
    expect(badbool).toMatchObject({ license: "CC BY-NC-SA 4.0", attribution: "Yael Grauer" });
  });

  it("counts live targets per source, once each, and skips retired ones", async () => {
    await ctx.close();
    const sources = {
      brokers: () => ({
        version: "test",
        records: [
          makeBroker({
            id: "alpha",
            domain: "alpha.example.com",
            sources: [
              { source: "eraser" as const, license: "MIT" as const },
              { source: "badbool" as const, license: "CC-BY-NC-SA-4.0" as const },
              { source: "eraser" as const, license: "MIT" as const, upstreamId: "again" },
            ],
          }),
          makeBroker({
            id: "beta",
            domain: "beta.example.com",
            sources: [{ source: "eraser" as const, license: "MIT" as const }],
          }),
        ],
      }),
      companies: () => ({ version: "test", records: [makeCompany({ id: "gamma" })] }),
    };
    ctx = await createTestContext({ targetSources: sources });
    ctx.services.targets.sync();
    const counts = async () => {
      const result = await ctx.call(API_ROUTES.settingsDataSources);
      if (!result.ok) throw new Error("data sources failed");
      return Object.fromEntries(result.body.sources.map((s) => [s.id, s.targetCount]));
    };
    expect(await counts()).toMatchObject({ eraser: 2, badbool: 1, "ca-registry-2026": 0 });

    ctx.services.db.update(targets).set({ retired: true }).run();
    expect(await counts()).toMatchObject({ eraser: 0, badbool: 0 });
  });
});
