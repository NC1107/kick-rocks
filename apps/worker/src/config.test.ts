import { LEASE_MS } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "./config.js";

const base = { KICKROCKS_WORKER_TOKEN: "a-token-of-sixteen-chars" };

describe("loadWorkerConfig", () => {
  it("applies defaults", () => {
    const config = loadWorkerConfig(base);
    expect(config).toMatchObject({
      serverUrl: "http://127.0.0.1:8420",
      token: base.KICKROCKS_WORKER_TOKEN,
      pollMs: 5000,
      leaseMs: 300_000,
      headless: false,
      noSandbox: false,
      allowHttp: false,
      pace: "human",
      chromeExecutable: null,
      logLevel: "info",
    });
    expect(config.workerId.length).toBeGreaterThan(0);
    expect(config.chromeProfileDir.endsWith(".chrome-profile")).toBe(true);
  });

  it("reads every setting from the environment", () => {
    const config = loadWorkerConfig({
      ...base,
      KICKROCKS_SERVER_URL: "http://server:8420/",
      KICKROCKS_WORKER_ID: "home-worker",
      KICKROCKS_WORKER_POLL_MS: "1000",
      KICKROCKS_WORKER_LEASE_MS: "60000",
      KICKROCKS_CHROME_PROFILE: "/data/chrome",
      KICKROCKS_WORKER_HEADLESS: "true",
      KICKROCKS_WORKER_NO_SANDBOX: "true",
      KICKROCKS_WORKER_ALLOW_HTTP: "true",
      KICKROCKS_WORKER_PACE: "instant",
      KICKROCKS_CHROME_EXECUTABLE: "/usr/local/bin/chrome",
      LOG_LEVEL: "debug",
    });
    expect(config).toEqual({
      serverUrl: "http://server:8420",
      token: base.KICKROCKS_WORKER_TOKEN,
      workerId: "home-worker",
      pollMs: 1000,
      leaseMs: 60000,
      chromeProfileDir: "/data/chrome",
      headless: true,
      noSandbox: true,
      allowHttp: true,
      pace: "instant",
      chromeExecutable: "/usr/local/bin/chrome",
      logLevel: "debug",
    });
  });

  it("requires a token of reasonable length", () => {
    expect(() => loadWorkerConfig({})).toThrow();
    expect(() => loadWorkerConfig({ KICKROCKS_WORKER_TOKEN: "short" })).toThrow(/at least 16/);
  });

  it("treats empty variables as unset", () => {
    const config = loadWorkerConfig({ ...base, KICKROCKS_SERVER_URL: "", KICKROCKS_WORKER_ID: "" });
    expect(config.serverUrl).toBe("http://127.0.0.1:8420");
    expect(config.workerId.length).toBeGreaterThan(0);
  });

  it("accepts the longest lease the server allows", () => {
    expect(
      loadWorkerConfig({ ...base, KICKROCKS_WORKER_LEASE_MS: String(LEASE_MS.max) }).leaseMs,
    ).toBe(LEASE_MS.max);
  });

  it("rejects values that would misbehave", () => {
    expect(() => loadWorkerConfig({ ...base, KICKROCKS_SERVER_URL: "not a url" })).toThrow();
    expect(() => loadWorkerConfig({ ...base, KICKROCKS_WORKER_POLL_MS: "10" })).toThrow();
    expect(() => loadWorkerConfig({ ...base, KICKROCKS_WORKER_LEASE_MS: "9999" })).toThrow();
    expect(() =>
      loadWorkerConfig({ ...base, KICKROCKS_WORKER_LEASE_MS: String(LEASE_MS.max + 1) }),
    ).toThrow();
    expect(() => loadWorkerConfig({ ...base, KICKROCKS_WORKER_HEADLESS: "maybe" })).toThrow();
    expect(() => loadWorkerConfig({ ...base, KICKROCKS_WORKER_PACE: "fast" })).toThrow();
    expect(() => loadWorkerConfig({ ...base, KICKROCKS_WORKER_ALLOW_HTTP: "1" })).toThrow();
  });
});
