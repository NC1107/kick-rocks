import { API_ROUTES, type RouteDef } from "@kickrocks/shared";
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

const concretePath = (route: RouteDef) => `/api${route.path.replace(/:\w+/g, "x")}`;

describe("module skeletons", () => {
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

  const stubbed = Object.entries(API_ROUTES).filter(([name]) => name !== "health");

  it.each(stubbed)("%s answers 501 until its module is built", async (_name, route) => {
    const request = {
      method: route.method,
      url: concretePath(route),
      payload: route.method === "GET" ? undefined : {},
    };
    const response =
      route.auth === "worker" ? await ctx.injectWorker(request) : await ctx.inject(request);
    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      error: "not_implemented",
      message: `${route.method} ${route.path} is not implemented yet`,
    });
  });

  it("serves health from the foundation", async () => {
    expect((await ctx.inject({ url: "/api/health" })).statusCode).toBe(200);
  });

  it("mounts the MCP stub at /mcp for every method", async () => {
    for (const method of ["POST", "GET", "DELETE"] as const) {
      const response = await ctx.injectMcp({ method, url: "/mcp" });
      expect(response.statusCode, method).toBe(501);
      expect(response.json().error).toBe("not_implemented");
    }
  });

  it("does not mount the web API under /mcp or the MCP stub under /api", async () => {
    expect((await ctx.injectMcp({ url: "/mcp/profiles" })).statusCode).toBe(404);
    expect((await ctx.inject({ url: "/api/mcp" })).statusCode).toBe(404);
  });
});
