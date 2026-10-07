import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 8420,
      webDist: null,
      publicUrl: "http://localhost:8420",
      workerToken: null,
      extraTargetsPath: null,
      extraRecipesDir: null,
      schedulerEnabled: true,
      sendGapMs: { min: 20_000, max: 60_000 },
      mail: { plaintextHosts: [] },
      linkFollower: { allowedPrivateHosts: [] },
      logLevel: "info",
      env: "development",
    });
    expect(config.dbPath).toBe(resolve("./data/kickrocks.db"));
    expect(config.keyPath).toBe(resolve("./data/db.key"));
  });

  it("reads the new variables", () => {
    const config = loadConfig({
      KICKROCKS_DATA_DIR: "/srv/kr",
      KICKROCKS_PORT: "9000",
      KICKROCKS_PUBLIC_URL: "https://kr.example.org/",
      KICKROCKS_WORKER_TOKEN: "0123456789abcdef",
      KICKROCKS_EXTRA_TARGETS: "/tmp/targets.json",
      KICKROCKS_EXTRA_RECIPES: "/tmp/recipes",
      KICKROCKS_SCHEDULER: "off",
    });
    expect(config).toMatchObject({
      dbPath: "/srv/kr/kickrocks.db",
      port: 9000,
      publicUrl: "https://kr.example.org",
      workerToken: "0123456789abcdef",
      extraTargetsPath: "/tmp/targets.json",
      extraRecipesDir: "/tmp/recipes",
      schedulerEnabled: false,
    });
  });

  it("reads the hosts the link follower may reach on a private address", () => {
    expect(
      loadConfig({
        KICKROCKS_ALLOW_PRIVATE_LINK_HOSTS: " Broker.test, optout.broker.test ,,127.0.0.1 ",
      }).linkFollower.allowedPrivateHosts,
    ).toEqual(["broker.test", "optout.broker.test", "127.0.0.1"]);
    expect(
      loadConfig({ KICKROCKS_ALLOW_PRIVATE_LINK_HOSTS: "" }).linkFollower.allowedPrivateHosts,
    ).toEqual([]);
  });

  it("reads the DKIM test keys only outside production", () => {
    expect(loadConfig({}).mail.dkimTestKeysPath).toBeNull();
    expect(
      loadConfig({ KICKROCKS_DKIM_TEST_KEYS: "/keys.json", NODE_ENV: "development" }).mail
        .dkimTestKeysPath,
    ).toBe("/keys.json");
    expect(
      loadConfig({ KICKROCKS_DKIM_TEST_KEYS: "/keys.json", NODE_ENV: "production" }).mail
        .dkimTestKeysPath,
    ).toBeNull();
  });

  it("trusts proxy headers only when asked to", () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ KICKROCKS_TRUST_PROXY: "1" }).trustProxy).toBe(1);
    expect(loadConfig({ KICKROCKS_TRUST_PROXY: "172.17.0.0/16, ::1" }).trustProxy).toEqual([
      "172.17.0.0/16",
      "::1",
    ]);
    expect(loadConfig({ KICKROCKS_TRUST_PROXY: "" }).trustProxy).toBe(false);
    expect(loadConfig({ KICKROCKS_TRUST_PROXY: "off" }).trustProxy).toBe(false);
  });

  it("refuses to trust every hop, which lets a client pick its own address", () => {
    expect(() => loadConfig({ KICKROCKS_TRUST_PROXY: "on" })).toThrow(/number of proxies/);
    expect(() => loadConfig({ KICKROCKS_TRUST_PROXY: "yes" })).toThrow();
  });

  it("derives the public url from the port when none is given", () => {
    expect(loadConfig({ KICKROCKS_PORT: "9001" }).publicUrl).toBe("http://localhost:9001");
  });

  it("treats empty variables as unset", () => {
    const config = loadConfig({
      KICKROCKS_WORKER_TOKEN: "",
      KICKROCKS_EXTRA_TARGETS: "",
      KICKROCKS_PUBLIC_URL: "",
      KICKROCKS_SCHEDULER: "",
    });
    expect(config).toMatchObject({
      workerToken: null,
      extraTargetsPath: null,
      schedulerEnabled: true,
    });
  });

  it("refuses a weak worker token and unknown switch values", () => {
    expect(() => loadConfig({ KICKROCKS_WORKER_TOKEN: "short" })).toThrow(/at least 16/);
    expect(() => loadConfig({ KICKROCKS_SCHEDULER: "maybe" })).toThrow();
    expect(() => loadConfig({ KICKROCKS_PUBLIC_URL: "nope" })).toThrow();
  });

  it("reads the pause between sends as one value or a range", () => {
    expect(loadConfig({ KICKROCKS_SEND_GAP_MS: "0" }).sendGapMs).toEqual({ min: 0, max: 0 });
    expect(loadConfig({ KICKROCKS_SEND_GAP_MS: "100-400" }).sendGapMs).toEqual({
      min: 100,
      max: 400,
    });
    expect(() => loadConfig({ KICKROCKS_SEND_GAP_MS: "400-100" })).toThrow(/minimum above/);
    expect(() => loadConfig({ KICKROCKS_SEND_GAP_MS: "soon" })).toThrow(/KICKROCKS_SEND_GAP_MS/);
  });

  it("reads the hosts that may be reached without TLS as a lower case list", () => {
    expect(
      loadConfig({ KICKROCKS_PLAINTEXT_MAIL_HOSTS: "GreenMail, mail.dev.test," }).mail
        .plaintextHosts,
    ).toEqual(["greenmail", "mail.dev.test"]);
  });
});
