import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../test-utils/index.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

describe("settings store", () => {
  it("reads defaults for keys that were never written", () => {
    const { settings } = ctx.services;
    expect(settings.get("schedule")).toEqual({
      pollMinutes: 15,
      peopleSearchRescanDays: 60,
      brokerRescanDays: 90,
      noResponseDays: 45,
      maxFollowUps: 2,
    });
    expect(settings.get("llm")).toBeNull();
    expect(settings.get("auth.passwordHash")).toBeNull();
    expect(settings.get("worker.status")).toBeNull();
  });

  it("round-trips a value and overwrites it", () => {
    const { settings } = ctx.services;
    settings.set("schedule", { ...settings.get("schedule"), pollMinutes: 5 });
    expect(settings.get("schedule").pollMinutes).toBe(5);
    settings.set("schedule", { ...settings.get("schedule"), pollMinutes: 7 });
    expect(settings.get("schedule").pollMinutes).toBe(7);
    settings.set("llm", { baseUrl: "http://localhost:11434/v1", model: "llama3", apiKey: null });
    expect(settings.get("llm")).toEqual({
      baseUrl: "http://localhost:11434/v1",
      model: "llama3",
      apiKey: null,
    });
  });

  it("refuses a value that does not fit the key", () => {
    expect(() => ctx.services.settings.set("mcp.enabled", "yes" as never)).toThrow();
    expect(() => ctx.services.settings.set("schedule", { pollMinutes: 0 } as never)).toThrow();
  });

  it("stamps the update time from the clock", async () => {
    const { settings } = await import("@kickrocks/db");
    ctx.services.settings.set("mcp.enabled", false);
    const row = ctx.services.db
      .select()
      .from(settings)
      .all()
      .find((r) => r.key === "mcp.enabled");
    expect(row?.updatedAt).toBe(ctx.clock.now().toISOString());
  });

  it("goes back to the default after a reset", () => {
    const { settings } = ctx.services;
    settings.set("mcp.enabled", false);
    settings.reset("mcp.enabled");
    expect(settings.get("mcp.enabled")).toBe(false);
    settings.set("auth.passwordHash", "hash");
    settings.reset("auth.passwordHash");
    expect(settings.get("auth.passwordHash")).toBeNull();
  });
});
