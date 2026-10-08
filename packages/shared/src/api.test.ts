import { describe, expect, it } from "vitest";
import { z } from "zod";
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
  toApiIssues,
} from "./api.js";
import { CampaignBody } from "./campaigns.js";
import { ScanStartBody } from "./scans.js";

/** The routes the web app and the workers depend on, so dropping one fails here. */
const PLANNED = [
  "GET /health",
  "GET /status",
  "GET /auth/state",
  "POST /auth/setup",
  "POST /auth/login",
  "POST /auth/logout",
  "POST /auth/password",
  "GET /profiles",
  "POST /profiles",
  "GET /profiles/:id",
  "GET /profiles/:id/export",
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
  "GET /targets/:id/site",
  "POST /profiles/:id/campaigns/preview",
  "POST /profiles/:id/campaigns",
  "GET /profiles/:id/requests",
  "GET /requests/:id",
  "POST /requests/:id/actions",
  "POST /requests/:id/verification",
  "GET /profiles/:id/dashboard",
  "POST /profiles/:id/scans",
  "GET /profiles/:id/scans",
  "GET /review",
  "POST /tasks/:id/resume",
  "POST /tasks/:id/cancel",
  "POST /tasks/:id/mark-done",
  "POST /tasks/:id/hand-off",
  "POST /tasks/:id/retry",
  "GET /tasks/:id/screenshot",
  "POST /matches/:id/decision",
  "GET /messages/:id",
  "POST /messages/:id/classification",
  "GET /recipes",
  "POST /recipes/:id/approve",
  "POST /recipes/:id/reject",
  "GET /settings",
  "PATCH /settings",
  "POST /settings/reset",
  "POST /settings/mcp-token",
  "GET /settings/jurisdictions",
  "GET /settings/data-sources",
  "GET /settings/sites",
  "GET /notifications",
  "PATCH /notifications",
  "POST /notifications/test",
  "POST /notifications/digest/send",
  "POST /worker/heartbeat",
  "POST /worker/claim",
  "POST /worker/tasks/:id/heartbeat",
  "POST /worker/tasks/:id/complete",
  "POST /worker/tasks/:id/release",
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
        "notifications",
        "worker-api",
      ]),
    );
    expect(routesOfModule("worker-api")).toHaveLength(7);
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

  it("applies to the auth routes too, which no cookie protects before sign in", () => {
    expect(requiresCsrfHeader(API_ROUTES.authLogin)).toBe(true);
    expect(requiresCsrfHeader(API_ROUTES.authSetup)).toBe(true);
    expect(requiresCsrfHeader(API_ROUTES.authLogout)).toBe(true);
    expect(requiresCsrfHeader(API_ROUTES.authState)).toBe(false);
  });

  it("treats a method by what it does, whatever the case", () => {
    expect(requiresCsrfHeader({ method: "head", auth: "session" })).toBe(false);
    expect(requiresCsrfHeader({ method: "OPTIONS", auth: "session" })).toBe(false);
    expect(requiresCsrfHeader({ method: "post", auth: "session" })).toBe(true);
    expect(requiresCsrfHeader({ method: "POST", auth: "mcp" })).toBe(false);
  });
});

describe("routes that take a task or a message", () => {
  it("lets a person finish a blocked task with a result", () => {
    expect(API_ROUTES.taskMarkDone.body.safeParse({}).success).toBe(true);
    expect(
      API_ROUTES.taskMarkDone.body.safeParse({ result: { outcome: "not_found" }, note: "n" })
        .success,
    ).toBe(true);
  });

  it("asks for the message and the approved fields to answer a broker", () => {
    expect(
      API_ROUTES.requestsVerification.body.safeParse({ messageId: "m", fields: ["date_of_birth"] })
        .success,
    ).toBe(true);
    expect(
      API_ROUTES.requestsVerification.body.safeParse({ messageId: "m", fields: [] }).success,
    ).toBe(false);
    expect(API_ROUTES.requestsVerification.body.safeParse({ fields: ["street"] }).success).toBe(
      false,
    );
  });

  it("tests a saved mailbox without the password", () => {
    const connection = {
      provider: "other",
      address: "a@example.com",
      username: "a@example.com",
      smtpHost: "smtp.example.test",
      smtpPort: 587,
      smtpSecure: false,
      imapHost: "imap.example.test",
      imapPort: 993,
    };
    expect(API_ROUTES.mailboxTest.body.safeParse(connection).success).toBe(true);
    expect(API_ROUTES.mailboxTest.body.safeParse({ ...connection, password: "x" }).success).toBe(
      true,
    );
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

  it("takes a target filter as a selection, and nothing beside it", () => {
    const body = (selection: unknown) => CampaignBody.safeParse({ selection, rights: ["opt_out"] });
    expect(body({ filter: { difficulty: "easy", kind: "company", q: "acme" } }).success).toBe(true);
    expect(body({ filter: {} }).success).toBe(true);
    expect(body({ preset: "easy" }).success).toBe(true);
    expect(body({ filter: { difficulty: "trivial" } }).success).toBe(false);
    expect(body({ filter: { page: 2 } }).success).toBe(false);
    expect(body({ filter: {}, preset: "easy" }).success).toBe(false);
    expect(ScanStartBody.safeParse({ filter: { category: "people-search" } }).success).toBe(true);
  });

  it("limits scans to the people_search preset", () => {
    expect(ScanStartBody.safeParse({ preset: "people_search" }).success).toBe(true);
    expect(ScanStartBody.safeParse({ preset: "companies" }).success).toBe(false);
    expect(ScanStartBody.safeParse({ targetIds: ["spokeo"] }).success).toBe(true);
  });
});

describe("toApiIssues", () => {
  it("starts every path with where the value was read from", () => {
    const parsed = CampaignBody.safeParse({ selection: { targetIds: [] }, rights: [] });
    if (parsed.success) throw new Error("expected a failure");
    const issues = toApiIssues(parsed.error, "body");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.path[0] === "body")).toBe(true);
    expect(issues.map((issue) => issue.path.join("."))).toContain("body.rights");
    expect(toApiIssues(parsed.error, "query")[0]?.path[0]).toBe("query");
  });

  it("keeps array indexes as numbers", () => {
    const parsed = z.object({ ids: z.array(z.string()) }).safeParse({ ids: ["a", 3] });
    if (parsed.success) throw new Error("expected a failure");
    expect(toApiIssues(parsed.error, "body")[0]?.path).toEqual(["body", "ids", 1]);
  });
});

describe("the health and status routes", () => {
  it("tell an anonymous caller only that the server is up", () => {
    expect(API_ROUTES.health.auth).toBe("none");
    expect(Object.keys(API_ROUTES.health.response.shape).sort()).toEqual(["ok", "version"]);
  });

  it("keep the counts behind the session", () => {
    expect(API_ROUTES.status.auth).toBe("session");
    expect(Object.keys(API_ROUTES.status.response.shape).sort()).toEqual([
      "brokers",
      "profiles",
      "targets",
    ]);
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
