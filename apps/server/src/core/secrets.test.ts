import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  TEST_MCP_TOKEN,
  TEST_WORKER_TOKEN,
  type TestContext,
} from "../test-utils/index.js";
import { bearerToken, generateToken, hashToken, safeEqual } from "./secrets.js";

describe("token helpers", () => {
  it("generates long, distinct, url-safe tokens", () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });

  it("hashes to a stable sha256 hex digest", () => {
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("compares equal and unequal strings of any length", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "secreT")).toBe(false);
    expect(safeEqual("secret", "secret-and-more")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("", "x")).toBe(false);
  });

  it("reads a bearer token and rejects anything else", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer abc123")).toBe("abc123");
    expect(bearerToken("  Bearer   abc123  ")).toBe("abc123");
    expect(bearerToken("Basic abc123")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken(["Bearer a", "Bearer b"])).toBeNull();
  });
});

describe("token checks", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("checks the worker token", () => {
    const { secrets } = ctx.services;
    expect(secrets.checkWorkerToken(`Bearer ${TEST_WORKER_TOKEN}`)).toBe("ok");
    expect(secrets.checkWorkerToken(`Bearer ${TEST_WORKER_TOKEN}x`)).toBe("invalid");
    expect(secrets.checkWorkerToken("Bearer nope")).toBe("invalid");
    expect(secrets.checkWorkerToken(undefined)).toBe("invalid");
    expect(secrets.checkWorkerToken(TEST_WORKER_TOKEN)).toBe("invalid");
  });

  it("reports the worker API as disabled when no token is configured", async () => {
    const bare = await createTestContext({ env: { KICKROCKS_WORKER_TOKEN: "" } });
    try {
      expect(bare.services.secrets.checkWorkerToken("Bearer anything")).toBe("disabled");
      expect(bare.services.secrets.checkWorkerToken(undefined)).toBe("disabled");
    } finally {
      await bare.close();
    }
  });

  it("checks the MCP token against its stored hash", () => {
    const { secrets, settings } = ctx.services;
    expect(secrets.checkMcpToken(`Bearer ${TEST_MCP_TOKEN}`)).toBe("ok");
    expect(secrets.checkMcpToken("Bearer wrong")).toBe("invalid");
    expect(secrets.checkMcpToken(undefined)).toBe("invalid");
    expect(settings.get("mcp.tokenHash")).toBe(hashToken(TEST_MCP_TOKEN));
    expect(settings.get("mcp.tokenHash")).not.toContain(TEST_MCP_TOKEN);
  });

  it("reports MCP as disabled when switched off or never given a token", () => {
    const { secrets, settings } = ctx.services;
    settings.set("mcp.enabled", false);
    expect(secrets.checkMcpToken(`Bearer ${TEST_MCP_TOKEN}`)).toBe("disabled");
    settings.set("mcp.enabled", true);
    settings.reset("mcp.tokenHash");
    expect(secrets.checkMcpToken(`Bearer ${TEST_MCP_TOKEN}`)).toBe("disabled");
  });

  it("rotates the MCP token, invalidating the old one and storing only a hash", () => {
    const { secrets, settings } = ctx.services;
    const token = secrets.rotateMcpToken();
    expect(secrets.checkMcpToken(`Bearer ${token}`)).toBe("ok");
    expect(secrets.checkMcpToken(`Bearer ${TEST_MCP_TOKEN}`)).toBe("invalid");
    expect(settings.get("mcp.tokenHash")).toBe(hashToken(token));
  });
});
