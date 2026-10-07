import { describe, expect, it } from "vitest";
import {
  API_ROUTES,
  ApiError,
  buildRoutePath,
  PageQuery,
  pageOf,
  RequestsQuery,
  requiresCsrfHeader,
  routesOfModule,
  TargetsQuery,
} from "./api.js";
import { CampaignBody } from "./campaigns.js";
import { ScanStartBody } from "./scans.js";

/** Every route listed in BUILD-PLAN section 4.4, plus the existing health check. */
const PLANNED = [
  "GET /health",
  "GET /auth/state",
  "POST /auth/setup",
  "POST /auth/login",
  "POST /auth/logout",
  "POST /auth/password",
  "GET /profiles",
  "POST /profiles",
  "GET /profiles/:id",
  "PATCH /profiles/:id",
  "DELETE /profiles/:id",
  "PUT /profiles/:id/identities",
  "GET /mail/providers",
  "POST /profiles/:id/mailbox/test",
  "PUT /profiles/:id/mailbox",
  "DELETE /profiles/:id/mailbox",
  "POST /profiles/:id/mailbox/poll",
  "GET /profiles/:id/mailbox/folders",
  "GET /targets",
  "GET /targets/facets",
  "GET /targets/:id",
  "POST /profiles/:id/campaigns/preview",
  "POST /profiles/:id/campaigns",
  "GET /profiles/:id/requests",
  "GET /requests/:id",
  "POST /requests/:id/actions",
  "GET /profiles/:id/dashboard",
  "POST /profiles/:id/scans",
  "GET /profiles/:id/scans",
  "GET /review",
  "POST /tasks/:id/resume",
  "POST /tasks/:id/cancel",
  "POST /tasks/:id/mark-done",
  "GET /tasks/:id/screenshot",
  "POST /matches/:id/decision",
  "POST /messages/:id/classification",
  "GET /recipes",
  "POST /recipes/:id/approve",
  "POST /recipes/:id/reject",
  "GET /settings",
  "PATCH /settings",
  "POST /settings/mcp-token",
  "GET /settings/jurisdictions",
  "GET /settings/data-sources",
  "POST /worker/heartbeat",
  "POST /worker/claim",
  "POST /worker/tasks/:id/heartbeat",
  "POST /worker/tasks/:id/complete",
  "POST /worker/tasks/:id/block",
  "POST /worker/tasks/:id/fail",
];

const routes = Object.entries(API_ROUTES);

describe("API_ROUTES", () => {
  it("defines exactly the planned routes, once each", () => {
    const defined = routes.map(([, route]) => `${route.method} ${route.path}`);
    expect([...defined].sort()).toEqual([...PLANNED].sort());
  });

  it("gives every route either a json response or a binary one", () => {
    for (const [name, route] of routes) {
      const hasResponse = "response" in route;
      const hasBinary = "binary" in route;
      expect(hasResponse !== hasBinary, name).toBe(true);
    }
  });

  it("declares a params schema for exactly the routes with path parameters", () => {
    for (const [name, route] of routes) {
      expect("params" in route, name).toBe(route.path.includes(":"));
    }
  });

  it("only gives bodies to routes that write", () => {
    for (const [name, route] of routes) {
      if ("body" in route) expect(route.method, name).not.toBe("GET");
    }
  });

  it("sends worker routes through the worker token and everything else through a session or none", () => {
    for (const [name, route] of routes) {
      expect(route.path.startsWith("/worker/"), name).toBe(route.auth === "worker");
    }
  });

  it("assigns every route to a module", () => {
    const modules = new Set(routes.map(([, route]) => route.module));
    expect(modules).toEqual(
      new Set([
        "core",
        "auth",
        "profiles",
        "mailbox",
        "targets",
        "campaigns",
        "requests",
        "dashboard",
        "scans",
        "review",
        "recipes",
        "settings",
        "worker-api",
      ]),
    );
    expect(routesOfModule("worker-api")).toHaveLength(6);
  });

  it("lets the server mount routes in any order without shadowing", () => {
    // Static segments must win over :id, which Fastify's router guarantees; this guards the names.
    expect(API_ROUTES.targetsFacets.path).toBe("/targets/facets");
    expect(API_ROUTES.targetsGet.path).toBe("/targets/:id");
  });
});

describe("body limits", () => {
  it("only the screenshot upload may exceed the server default", () => {
    const limited = routes.filter(([, route]) => "bodyLimit" in route).map(([name]) => name);
    expect(limited).toEqual(["workerTaskBlock"]);
    expect(API_ROUTES.workerTaskBlock.bodyLimit).toBeGreaterThan(8 * 1024 * 1024);
  });
});

describe("requiresCsrfHeader", () => {
  it("applies to state-changing browser routes only", () => {
    expect(requiresCsrfHeader(API_ROUTES.profilesCreate)).toBe(true);
    expect(requiresCsrfHeader(API_ROUTES.profilesDelete)).toBe(true);
    expect(requiresCsrfHeader(API_ROUTES.settingsPatch)).toBe(true);
    expect(requiresCsrfHeader(API_ROUTES.profilesGet)).toBe(false);
    expect(requiresCsrfHeader(API_ROUTES.workerClaim)).toBe(false);
  });
});

describe("buildRoutePath", () => {
  it("fills and encodes parameters", () => {
    expect(buildRoutePath("/profiles/:id/mailbox", { id: "a b/c" })).toBe(
      "/profiles/a%20b%2Fc/mailbox",
    );
    expect(buildRoutePath("/health")).toBe("/health");
  });

  it("throws when a parameter is missing", () => {
    expect(() => buildRoutePath("/profiles/:id")).toThrow(/Missing path parameter "id"/);
  });
});

describe("pagination", () => {
  it("defaults and coerces query strings", () => {
    expect(PageQuery.parse({})).toEqual({ page: 1, pageSize: 50 });
    expect(PageQuery.parse({ page: "3", pageSize: "20" })).toEqual({ page: 3, pageSize: 20 });
  });

  it("rejects out of range pages", () => {
    expect(PageQuery.safeParse({ page: "0" }).success).toBe(false);
    expect(PageQuery.safeParse({ pageSize: "500" }).success).toBe(false);
    expect(PageQuery.safeParse({ pageSize: "abc" }).success).toBe(false);
  });

  it("wraps an item schema in a page", () => {
    const schema = pageOf(PageQuery);
    expect(schema.safeParse({ items: [], total: 0, page: 1, pageSize: 50 }).success).toBe(true);
    expect(schema.safeParse({ items: [], total: -1, page: 1, pageSize: 50 }).success).toBe(false);
  });
});

describe("list queries", () => {
  it("splits a comma separated status filter", () => {
    expect(RequestsQuery.parse({ status: "sent,awaiting_reply" }).status).toEqual([
      "sent",
      "awaiting_reply",
    ]);
    expect(RequestsQuery.parse({}).status).toBeUndefined();
    expect(RequestsQuery.safeParse({ status: "sent,bogus" }).success).toBe(false);
  });

  it("filters targets by broker or company category", () => {
    expect(TargetsQuery.safeParse({ category: "people-search" }).success).toBe(true);
    expect(TargetsQuery.safeParse({ category: "retail" }).success).toBe(true);
    expect(TargetsQuery.safeParse({ category: "weather" }).success).toBe(false);
    expect(TargetsQuery.parse({ requirement: "captcha", priority: "crucial", q: " spo " }).q).toBe(
      "spo",
    );
  });
});

describe("campaign and scan selections", () => {
  it("takes target ids or a preset, never both", () => {
    expect(
      CampaignBody.safeParse({ selection: { targetIds: ["a"] }, rights: ["opt_out"] }).success,
    ).toBe(true);
    expect(
      CampaignBody.safeParse({ selection: { preset: "everything" }, rights: ["opt_out", "delete"] })
        .success,
    ).toBe(true);
    expect(
      CampaignBody.safeParse({
        selection: { preset: "everything", targetIds: ["a"] },
        rights: ["opt_out"],
      }).success,
    ).toBe(false);
    expect(
      CampaignBody.safeParse({ selection: { targetIds: [] }, rights: ["opt_out"] }).success,
    ).toBe(false);
    expect(
      CampaignBody.safeParse({ selection: { preset: "nope" }, rights: ["opt_out"] }).success,
    ).toBe(false);
  });

  it("requires at least one right, each at most once", () => {
    expect(CampaignBody.safeParse({ selection: { preset: "companies" }, rights: [] }).success).toBe(
      false,
    );
    expect(
      CampaignBody.safeParse({ selection: { preset: "companies" }, rights: ["delete", "delete"] })
        .success,
    ).toBe(false);
  });

  it("limits scans to the people_search preset", () => {
    expect(ScanStartBody.safeParse({ preset: "people_search" }).success).toBe(true);
    expect(ScanStartBody.safeParse({ preset: "companies" }).success).toBe(false);
    expect(ScanStartBody.safeParse({ targetIds: ["spokeo"] }).success).toBe(true);
  });
});

describe("ApiError", () => {
  it("accepts the documented shapes", () => {
    expect(ApiError.safeParse({ error: "not_found" }).success).toBe(true);
    expect(
      ApiError.safeParse({
        error: "invalid_request",
        message: "bad",
        issues: [{ path: ["body", 0], message: "x" }],
      }).success,
    ).toBe(true);
    expect(ApiError.safeParse({ message: "no code" }).success).toBe(false);
  });
});
