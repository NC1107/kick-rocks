import { API_ROUTES, type RouteDef } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routeKey, stubbedRoutes } from "../core/http.js";
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

/**
 * These tests hold whether a module is still a skeleton or has been built, so a module landing
 * never makes one of them fail. What a built module does is tested in the module itself.
 */
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

  const routes = Object.entries(API_ROUTES);

  it.each(routes)("%s is registered, whether its module is built or not", (_name, route) => {
    expect(ctx.app.hasRoute({ method: route.method, url: `/api${route.path}` })).toBe(true);
  });

  it("only answers 501 for the routes still marked as stubs, and every stub is in the table", async () => {
    const byKey = new Map(routes.map(([, route]) => [routeKey(route), route]));
    for (const key of stubbedRoutes) expect(byKey.has(key), key).toBe(true);
    for (const key of stubbedRoutes) {
      const route = byKey.get(key) as RouteDef;
      const request = {
        method: route.method,
        url: concretePath(route),
        payload: route.method === "GET" ? undefined : {},
      };
      const response =
        route.auth === "worker" ? await ctx.injectWorker(request) : await ctx.inject(request);
      expect(response.statusCode, key).toBe(501);
      expect(response.json(), key).toEqual({
        error: "not_implemented",
        message: `${route.method} ${route.path} is not implemented yet`,
      });
    }
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
