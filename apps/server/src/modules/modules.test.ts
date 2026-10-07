import { API_ROUTES } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../test-utils/index.js";
import { MODULES } from "./index.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

/** What each module does is tested in the module itself; this checks only that all of them are mounted. */
describe("modules", () => {
  it("registers every module the ownership map names", () => {
    expect(MODULES.map((m) => m.name).sort()).toEqual(
      [
        "auth",
        "campaigns",
        "dashboard",
        "mailbox",
        "mcp",
        "profiles",
        "recipes",
        "requests",
        "review",
        "scans",
        "settings",
        "targets",
        "worker-api",
      ].sort(),
    );
    expect(MODULES.find((m) => m.name === "mcp")?.prefix).toBe("/mcp");
    expect(MODULES.filter((m) => m.name !== "mcp").every((m) => m.prefix === "/api")).toBe(true);
  });

  const routes = Object.entries(API_ROUTES);

  it.each(routes)("%s is registered", (_name, route) => {
    expect(ctx.app.hasRoute({ method: route.method, url: `/api${route.path}` })).toBe(true);
  });

  it("serves health from the foundation", async () => {
    expect((await ctx.inject({ url: "/api/health" })).statusCode).toBe(200);
  });

  it("answers at /mcp for a caller with the MCP token, whatever the module does with it", async () => {
    for (const method of ["POST", "GET", "DELETE"] as const) {
      const response = await ctx.injectMcp({
        method,
        url: "/mcp",
        payload: method === "POST" ? {} : undefined,
      });
      expect([401, 503], method).not.toContain(response.statusCode);
    }
  });

  it("does not mount the web API under /mcp or the MCP endpoint under /api", async () => {
    expect((await ctx.injectMcp({ url: "/mcp/profiles" })).statusCode).toBe(404);
    expect((await ctx.inject({ url: "/api/mcp" })).statusCode).toBe(404);
  });
});
