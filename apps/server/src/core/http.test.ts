import { API_ROUTES, toApiIssues } from "@kickrocks/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { AppError, conflict, invalidRequest, notFound } from "./errors.js";
import { installErrorHandling, registerRoute } from "./http.js";

let app: FastifyInstance;

async function build(setup: (app: FastifyInstance) => void, options: { bodyLimit?: number } = {}) {
  app = Fastify({ bodyLimit: options.bodyLimit ?? 1024 * 1024 });
  installErrorHandling(app);
  setup(app);
  await app.ready();
  return app;
}

afterEach(async () => {
  await app.close();
});

const identities = [
  { kind: "name", value: { first: "Jordan", last: "Example" }, isPrimary: true },
  { kind: "email", value: { address: "jordan@example.com" }, isPrimary: true },
];

describe("registerRoute validation", () => {
  it("hands the handler parsed params, query, and body", async () => {
    let seen: unknown;
    await build((a) => {
      registerRoute(a, API_ROUTES.targetsList, ({ query }) => {
        seen = query;
        return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
      });
    });
    const response = await app.inject({ method: "GET", url: "/targets?q=%20spo%20&pageSize=20" });
    expect(response.statusCode).toBe(200);
    expect(seen).toEqual({ page: 1, pageSize: 20, q: "spo" });
  });

  it("answers 400 with the failing paths when the body is invalid", async () => {
    await build((a) => registerRoute(a, API_ROUTES.profilesCreate, () => ({}) as never));
    const response = await app.inject({
      method: "POST",
      url: "/profiles",
      payload: { displayName: "", state: "ZZ", identities: [] },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toMatchObject({
      error: "invalid_request",
      message: "The request body is invalid",
    });
    const paths = body.issues.map((issue: { path: string[] }) => issue.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["body.displayName", "body.state"]));
  });

  it("builds issue paths with the shared helper, so the mock API cannot spell them differently", async () => {
    await build((a) => registerRoute(a, API_ROUTES.profilesCreate, () => ({}) as never));
    const payload = {
      displayName: "Jordan",
      state: "TX",
      identities: [
        { kind: "name", value: { first: "A", last: "B" }, isPrimary: true },
        { kind: "email", value: { address: "a@example.com" } },
        { kind: "address", value: { street: "1 Main", city: "Austin", state: "ZZ", zip: "78701" } },
      ],
    };
    const response = await app.inject({ method: "POST", url: "/profiles", payload });
    const parsed = API_ROUTES.profilesCreate.body.safeParse(payload);
    if (parsed.success) throw new Error("the payload was meant to be invalid");
    expect(response.json().issues).toEqual(toApiIssues(parsed.error, "body"));
    // The same literal path is asserted in the web mock's test, which is how the two stay equal.
    expect(response.json().issues[0].path).toEqual(["body", "identities", 2, "value", "state"]);
  });

  it("answers 400 for a bad query value", async () => {
    await build((a) => registerRoute(a, API_ROUTES.targetsList, () => ({}) as never));
    const response = await app.inject({ method: "GET", url: "/targets?pageSize=abc" });
    expect(response.statusCode).toBe(400);
    expect(response.json().issues[0].path).toEqual(["query", "pageSize"]);
  });

  it("answers 400 for a missing body", async () => {
    await build((a) => registerRoute(a, API_ROUTES.profilesCreate, () => ({}) as never));
    const response = await app.inject({ method: "POST", url: "/profiles" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_request");
  });

  it("rejects an unparseable json body", async () => {
    await build((a) => registerRoute(a, API_ROUTES.profilesCreate, () => ({}) as never));
    const response = await app.inject({
      method: "POST",
      url: "/profiles",
      headers: { "content-type": "application/json" },
      payload: "{ nope",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_request");
  });

  it("rejects a body over the limit", async () => {
    await build((a) => registerRoute(a, API_ROUTES.profilesCreate, () => ({}) as never), {
      bodyLimit: 50,
    });
    const response = await app.inject({
      method: "POST",
      url: "/profiles",
      payload: { displayName: "x".repeat(200), state: "TX", identities },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error).toBe("payload_too_large");
  });

  it("accepts a larger body only on a route that asks for it", async () => {
    await build(
      (a) => {
        registerRoute(a, API_ROUTES.profilesCreate, () => ({}) as never);
        registerRoute(a, API_ROUTES.workerTaskBlock, () => ({ task: {} }) as never);
      },
      { bodyLimit: 100 },
    );
    const big = "x".repeat(500);
    expect(
      (await app.inject({ method: "POST", url: "/profiles", payload: { big } })).statusCode,
    ).toBe(413);
    const block = await app.inject({
      method: "POST",
      url: "/worker/tasks/t1/block",
      payload: { workerId: "w", reason: "captcha", detail: big },
    });
    expect(block.statusCode).not.toBe(413);
  });

  it("passes route params", async () => {
    let id = "";
    await build((a) =>
      registerRoute(a, API_ROUTES.profilesDelete, ({ params }) => {
        id = params.id;
        return { ok: true as const };
      }),
    );
    expect((await app.inject({ method: "DELETE", url: "/profiles/abc%20d" })).statusCode).toBe(200);
    expect(id).toBe("abc d");
  });
});

describe("registerRoute responses", () => {
  const detail = {
    id: "p1",
    displayName: "Jordan Example",
    state: "TX",
    primaryEmail: "jordan@example.com",
    mailboxConnected: false,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
    identities: [],
    mailbox: null,
  };

  it("uses the route's success status", async () => {
    await build((a) => registerRoute(a, API_ROUTES.profilesCreate, () => detail as never));
    const response = await app.inject({
      method: "POST",
      url: "/profiles",
      payload: { displayName: "J", state: "TX", identities },
    });
    expect(response.statusCode).toBe(201);
  });

  it("strips fields the contract does not name, so a stray column cannot leak", async () => {
    await build((a) =>
      registerRoute(
        a,
        API_ROUTES.profilesGet,
        () => ({ ...detail, passwordHash: "secret", mailbox: null }) as never,
      ),
    );
    const response = await app.inject({ method: "GET", url: "/profiles/p1" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(detail);
    expect(response.body).not.toContain("secret");
  });

  it("answers 500 without details when the handler breaks the contract", async () => {
    await build((a) => registerRoute(a, API_ROUTES.profilesGet, () => ({ id: 1 }) as never));
    const response = await app.inject({ method: "GET", url: "/profiles/p1" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal_error" });
  });

  it("sends a binary body with its content type and no caching", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await build((a) =>
      registerRoute(a, API_ROUTES.taskScreenshot, () => ({ contentType: "image/png", data: png })),
    );
    const response = await app.inject({ method: "GET", url: "/tasks/t1/screenshot" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(Buffer.compare(response.rawPayload, png)).toBe(0);
  });

  it("lets a handler answer directly through the reply", async () => {
    await build((a) =>
      registerRoute(a, API_ROUTES.profilesDelete, ({ reply }) => {
        reply.code(202).send({ accepted: true });
        return undefined as never;
      }),
    );
    const response = await app.inject({ method: "DELETE", url: "/profiles/p1" });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true });
  });
});

describe("error handling", () => {
  it.each([
    [notFound("Nope"), 404, { error: "not_found", message: "Nope" }],
    [
      conflict("lease_not_held", "Not yours"),
      409,
      { error: "lease_not_held", message: "Not yours" },
    ],
    [
      invalidRequest("Bad", [{ path: ["body", "x"], message: "Required" }]),
      400,
      {
        error: "invalid_request",
        message: "Bad",
        issues: [{ path: ["body", "x"], message: "Required" }],
      },
    ],
    [
      new AppError(429, "rate_limited", "Slow down"),
      429,
      { error: "rate_limited", message: "Slow down" },
    ],
  ])("sends an AppError as { error, message, issues }", async (error, status, body) => {
    await build((a) =>
      a.get("/boom", () => {
        throw error;
      }),
    );
    const response = await app.inject({ method: "GET", url: "/boom" });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual(body);
  });

  it("hides the cause of an unexpected error", async () => {
    await build((a) =>
      a.get("/boom", () => {
        throw new Error("database password is hunter2");
      }),
    );
    const response = await app.inject({ method: "GET", url: "/boom" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal_error" });
    expect(response.body).not.toContain("hunter2");
  });
});
