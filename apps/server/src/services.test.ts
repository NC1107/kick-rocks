import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotImplementedError } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, openAppDatabase } from "./app.js";
import { loadConfig } from "./config.js";
import { systemClock } from "./core/clock.js";
import { createServices } from "./services.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kickrocks-services-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createServices with no overrides", () => {
  it("wires the production defaults", async () => {
    const config = loadConfig({
      KICKROCKS_DATA_DIR: dir,
      LOG_LEVEL: "silent",
      KICKROCKS_SCHEDULER: "off",
    });
    const database = openAppDatabase(config);
    try {
      const services = createServices(config, database.db);
      expect(services.clock).toBe(systemClock);
      expect(services.config).toBe(config);
      expect(Object.keys(services).sort()).toEqual(
        [
          "auth",
          "clock",
          "config",
          "db",
          "dispatch",
          "legal",
          "logger",
          "mail",
          "recipeHealth",
          "requests",
          "secrets",
          "settings",
          "targets",
          "taskHandlers",
          "taskQueue",
        ].sort(),
      );
      await expect(services.mail.transport({} as never).verify()).rejects.toThrow(
        NotImplementedError,
      );
      expect(() => services.legal.listJurisdictions()).toThrow(NotImplementedError);
      expect(await services.auth.authenticate({} as never)).toEqual({ ok: true });
    } finally {
      database.close();
    }
  });

  it("loads the real broker dataset when the app starts", async () => {
    const config = loadConfig({
      KICKROCKS_DATA_DIR: dir,
      LOG_LEVEL: "silent",
      KICKROCKS_SCHEDULER: "off",
    });
    const database = openAppDatabase(config);
    const app = await buildApp({
      services: createServices(config, database.db),
      database,
      version: "test",
    });
    try {
      const health = (await app.server.inject({ url: "/api/health" })).json();
      expect(health.brokers.total).toBeGreaterThan(500);
      expect(health.targets.brokers).toBe(health.brokers.total);
    } finally {
      await app.close();
    }
  });

  it("reuses the same database across restarts without duplicating targets", async () => {
    const config = loadConfig({
      KICKROCKS_DATA_DIR: dir,
      LOG_LEVEL: "silent",
      KICKROCKS_SCHEDULER: "off",
    });
    const counts: number[] = [];
    for (let run = 0; run < 2; run++) {
      const database = openAppDatabase(config);
      const app = await buildApp({
        services: createServices(config, database.db),
        database,
        version: "test",
      });
      counts.push((await app.server.inject({ url: "/api/health" })).json().targets.brokers);
      await app.close();
    }
    expect(counts[0]).toBe(counts[1]);
  });
});
