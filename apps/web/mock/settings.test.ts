import { describe, expect, it } from "vitest";
import { app, call, freshMockAppEachTest } from "./test-helpers.js";

freshMockAppEachTest();

describe("settings and recipe handlers", () => {
  it("patches the schedule and the LLM, and mints a token once", async () => {
    const patched = await call({
      method: "PATCH",
      path: "/settings",
      body: {
        schedule: { pollMinutes: 30 },
        llm: { baseUrl: "http://localhost:11434/v1", model: "llama3", apiKey: "secret" },
      },
    });
    expect(patched.json.schedule.pollMinutes).toBe(30);
    expect(patched.json.schedule.noResponseDays).toBe(45);
    expect(patched.json.llm).toEqual({
      baseUrl: "http://localhost:11434/v1",
      model: "llama3",
      apiKeySet: true,
    });
    expect(JSON.stringify(patched.json)).not.toContain("secret");

    const token = await call({ method: "POST", path: "/settings/mcp-token" });
    expect(token.json.token).toMatch(/^krmcp_[0-9a-f]{40}$/);
    expect((await call({ path: "/settings" })).json.mcp.tokenSet).toBe(true);
    expect(
      (await call({ method: "PATCH", path: "/settings", body: { llm: null } })).json.llm,
    ).toBeNull();
  });

  it("approves and rejects proposed recipes", async () => {
    const pending = await call({ path: "/recipes?status=pending_review" });
    expect(pending.json.recipes.length).toBeGreaterThanOrEqual(2);
    const [first, second] = pending.json.recipes;
    expect((await call({ method: "POST", path: `/recipes/${first.id}/approve` })).json.status).toBe(
      "active",
    );
    expect((await call({ method: "POST", path: `/recipes/${second.id}/reject` })).json.status).toBe(
      "rejected",
    );
    expect((await call({ method: "POST", path: `/recipes/${first.id}/approve` })).status).toBe(409);
  });

  it("lists data sources with how many targets carry each", async () => {
    const sources = await call({ path: "/settings/data-sources" });
    const counts = Object.fromEntries(
      sources.json.sources.map((source: { id: string; targetCount: number }) => [
        source.id,
        source.targetCount,
      ]),
    );
    expect(counts.badbool).toBeGreaterThan(0);
    expect(counts["kickrocks-companies"]).toBeGreaterThan(0);
  });
});

describe("retention and reset handlers", () => {
  it("patches one retention window at a time", async () => {
    await call({ method: "PATCH", path: "/settings", body: { retention: { messageDays: 90 } } });
    const patched = await call({
      method: "PATCH",
      path: "/settings",
      body: { retention: { screenshotDays: null } },
    });
    expect(patched.json.retention).toEqual({ messageDays: 90, screenshotDays: null });
  });

  it("resets only with the typed phrase", async () => {
    const wrong = await call({
      method: "POST",
      path: "/settings/reset",
      body: { confirm: "reset" },
    });
    expect(wrong.status).toBe(400);
    expect(app.store.profiles.length).toBeGreaterThan(0);
  });

  it("wipes the data and the instance settings", async () => {
    await call({
      method: "PATCH",
      path: "/settings",
      body: { schedule: { pollMinutes: 5 }, retention: { messageDays: 30 } },
    });
    const done = await call({
      method: "POST",
      path: "/settings/reset",
      body: { confirm: "delete everything" },
    });
    expect(done.json).toEqual({ ok: true });
    expect(app.store.profiles).toEqual([]);
    expect(app.store.requests).toEqual([]);
    expect(app.store.messages).toEqual([]);
    const settings = (await call({ path: "/settings" })).json;
    expect(settings.schedule.pollMinutes).toBe(15);
    expect(settings.retention).toEqual({ messageDays: null, screenshotDays: 30 });
  });
});
