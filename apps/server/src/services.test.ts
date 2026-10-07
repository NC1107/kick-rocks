import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { targets } from "@kickrocks/db";
import { count } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, openAppDatabase } from "./app.js";
import { loadConfig } from "./config.js";
import { systemClock } from "./core/clock.js";
import { createServices } from "./services.js";
import { makeBroker } from "./test-utils/builders.js";

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
      // Only the set of services is checked: what each one does changes as its module is built.
      expect(Object.keys(services).sort()).toEqual(
        [
          "auth",
          "clock",
          "composer",
          "config",
          "db",
          "dispatch",
          "legal",
          "logger",
          "mail",
          "mailHolds",
          "mailQuota",
          "recipeHealth",
          "requests",
          "secrets",
          "settings",
          "startup",
          "targets",
          "taskHandlers",
          "taskQueue",
        ].sort(),
      );
      expect(typeof services.requests.open).toBe("function");
      expect(typeof services.requests.requeue).toBe("function");
      expect(typeof services.legal.getLegalBasis).toBe("function");
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
      expect((await app.server.inject({ url: "/api/health" })).statusCode).toBe(200);
      const total = database.db.select({ n: count() }).from(targets).get()?.n ?? 0;
      expect(total).toBeGreaterThan(500);
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
      counts.push(database.db.select({ n: count() }).from(targets).get()?.n ?? 0);
      await app.close();
    }
    expect(counts[0]).toBe(counts[1]);
  });
});

describe("startup order", () => {
  it("syncs the targets before a module plugin registers and runs startup steps after both", async () => {
    const config = loadConfig({
      KICKROCKS_DATA_DIR: dir,
      LOG_LEVEL: "silent",
      KICKROCKS_SCHEDULER: "off",
    });
    const database = openAppDatabase(config);
    const services = createServices(config, database.db, {
      targetSources: {
        brokers: () => ({
          version: "t",
          records: [makeBroker({ id: "first-boot", domain: "first-boot.test" })],
        }),
        companies: () => null,
      },
    });
    const seen: Array<{ step: string; targets: number }> = [];
    const targetsNow = () => database.db.select({ n: count() }).from(targets).get()?.n ?? 0;
    services.startup.onReady(
      "first",
      () => void seen.push({ step: "first", targets: targetsNow() }),
    );
    services.startup.onReady("second", async () => {
      await Promise.resolve();
      seen.push({ step: "second", targets: targetsNow() });
    });
    const app = await buildApp({ services, database, version: "test" });
    try {
      // A fresh database already holds the targets by the time any startup step looks.
      expect(seen).toEqual([
        { step: "first", targets: 1 },
        { step: "second", targets: 1 },
      ]);
    } finally {
      await app.close();
    }
  });

  it("stops the server from starting when a step fails, naming it", async () => {
    const config = loadConfig({
      KICKROCKS_DATA_DIR: dir,
      LOG_LEVEL: "silent",
      KICKROCKS_SCHEDULER: "off",
    });
    const database = openAppDatabase(config);
    const services = createServices(config, database.db, {
      targetSources: { brokers: () => null, companies: () => null },
    });
    services.startup.onReady("recipes", () => {
      throw new Error("no such directory");
    });
    await expect(buildApp({ services, database, version: "test" })).rejects.toThrow(
      /Startup step "recipes" failed: no such directory/,
    );
    database.close();
  });
});
