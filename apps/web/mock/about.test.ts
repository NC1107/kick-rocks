import { DATA_SOURCE_DETAILS, DataSourceId } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { app, call, freshMockAppEachTest } from "./test-helpers.js";

freshMockAppEachTest();

describe("about handlers", () => {
  it("answers the health check to anyone, with a version", async () => {
    const response = await call({ path: "/health" });
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ ok: true, version: "0.1.0-mock" });
  });

  it("answers 503 with the version when the instance is unwell, and says why behind the session", async () => {
    app.store.health = "scheduler";
    const health = await call({ path: "/health" });
    expect(health.status).toBe(503);
    expect(health.json).toEqual({ ok: false, version: "0.1.0-mock" });
    expect((await call({ path: "/status" })).json.health.scheduler.stalled).toBe(true);
  });

  it("counts profiles and targets from the store", async () => {
    const { json } = await call({ path: "/status" });
    expect(json.profiles).toBe(app.store.profiles.length);
    expect(json.targets.brokers).toBe(app.store.targets.filter((t) => t.kind === "broker").length);
    expect(json.targets.companies).toBe(
      app.store.targets.filter((t) => t.kind === "company").length,
    );
    expect(json.brokers.available).toBe(true);
  });

  it("lists every data source with the license and attribution the shared table states", async () => {
    const { json } = await call({ path: "/settings/data-sources" });
    expect(json.sources.map((source: { id: string }) => source.id)).toEqual([
      ...DataSourceId.options,
    ]);
    const badbool = json.sources.find((source: { id: string }) => source.id === "badbool");
    expect(badbool.license).toBe(DATA_SOURCE_DETAILS.badbool.license);
    expect(badbool.attribution).toBe("Yael Grauer");
  });

  it("counts the targets that carry each source", async () => {
    const { json } = await call({ path: "/settings/data-sources" });
    for (const source of json.sources as { id: string; targetCount: number }[]) {
      const expected = app.store.targets.filter((target) =>
        target.sources.some((carried) => carried.source === source.id),
      ).length;
      expect(source.targetCount).toBe(expected);
    }
  });

  it("needs a session for the status and the sources, but not for health", async () => {
    app.store.auth.authenticated = false;
    expect((await call({ path: "/health" })).status).toBe(200);
    expect((await call({ path: "/status" })).status).toBe(401);
    expect((await call({ path: "/settings/data-sources" })).status).toBe(401);
  });
});

describe("restore handlers", () => {
  it("reports no hold by default", async () => {
    const { json } = await call({ path: "/restore" });
    expect(json).toEqual({ holding: false, restoredAt: null, problem: null });
  });

  it("holds with a reason when the mailbox could not be checked, and lets a person resume", async () => {
    app.store.health = "restore_problem";
    expect((await call({ path: "/restore" })).json).toMatchObject({
      holding: true,
      problem: expect.stringContaining("Sent folder"),
    });
    const resumed = await call({
      method: "POST",
      path: "/restore/resume",
      body: { confirm: true },
    });
    expect(resumed.json.holding).toBe(false);
    expect(app.store.health).toBe("ok");
  });
});
