import { API_ROUTES } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../test-utils/index.js";
import { createHostPolicy } from "./hosts.js";

const policy = createHostPolicy({
  publicUrl: "https://kr.example.org",
  allowedHosts: ["kickrocks.lan"],
});

describe("the names the server answers to", () => {
  it.each([
    "localhost:8420",
    "127.0.0.1:8420",
    "[::1]:8420",
    "192.168.1.20:8420",
    "app.localhost",
    "kr.example.org",
    "KR.example.org:443",
    "kickrocks.lan:8420",
  ])("accepts %s", (host) => {
    expect(policy(host)).toBe(true);
  });

  it.each([
    undefined,
    "",
    "evil.example:8420",
    "kr.example.org.evil.example",
    "localhost.evil.example",
  ])("refuses %s", (host) => {
    expect(policy(host)).toBe(false);
  });
});

describe("a request that names another host", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({ auth: "real" });
  });

  afterEach(async () => {
    await ctx.close();
  });

  const asHost = (host: string) => ({ host, origin: `http://${host}` });

  it("cannot set up a fresh instance through DNS rebinding", async () => {
    const response = await ctx.inject({
      method: API_ROUTES.authSetup.method,
      url: `/api${API_ROUTES.authSetup.path}`,
      payload: { password: "correct horse battery" },
      headers: asHost("evil.example:8420"),
    });
    expect(response.statusCode).toBe(421);
    expect(response.json().error).toBe("misdirected_request");
    const state = await ctx.inject({ url: "/api/auth/state" });
    expect(state.json()).toMatchObject({ setupRequired: true });
  });

  it("is refused by the MCP origin check even when Origin and Host agree", async () => {
    const response = await ctx.injectMcp({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      headers: asHost("evil.example:8420"),
    });
    expect(response.statusCode).toBe(403);
  });

  it("may still use any name when it carries the worker token, as a container does", async () => {
    const response = await ctx.injectWorker({
      url: "/api/worker/ping",
      headers: { host: "server:8420" },
    });
    expect(response.statusCode).not.toBe(421);
  });
});
