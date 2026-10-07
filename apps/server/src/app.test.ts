import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type App, buildApp, openAppDatabase } from "./app.js";
import { loadConfig } from "./config.js";

let dir: string;
let app: App;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "kickrocks-server-"));
  const config = loadConfig({
    KICKROCKS_DATA_DIR: dir,
    LOG_LEVEL: "error",
    NODE_ENV: "test",
  });
  app = await buildApp({ config, database: openAppDatabase(config), version: "test" });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/health", () => {
  it("reports status, version, and counts", async () => {
    const response = await app.server.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ ok: true, version: "test", profiles: 0 });
    expect(typeof body.brokers.total).toBe("number");
  });

  it("returns json 404 for unknown api routes", async () => {
    const response = await app.server.inject({ method: "GET", url: "/api/nope" });
    expect(response.statusCode).toBe(404);
  });
});
