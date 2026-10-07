import {
  API_ROUTES,
  buildRoutePath,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  RequestStatus,
  type RouteDef,
} from "@kickrocks/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createMockApp, type MockApp, type MockRequest } from "./app.js";

// Written by code point so this file does not contain the character it forbids.
const EM_DASH = String.fromCodePoint(0x2014);

let app: MockApp;

beforeEach(() => {
  app = createMockApp();
});

interface Call {
  method?: string;
  path: string;
  body?: unknown;
  csrf?: boolean;
}

async function call({ method = "GET", path, body, csrf = method !== "GET" }: Call) {
  const request: MockRequest = {
    method,
    url: `/api${path}`,
    headers: csrf ? { [CSRF_HEADER]: CSRF_HEADER_VALUE } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  const response = await app.handle(request);
  const text = typeof response.body === "string" ? response.body : "";
  return {
    status: response.status,
    headers: response.headers,
    json: text ? JSON.parse(text) : null,
    raw: response.body,
  };
}

const jordan = () => app.store.profiles[0] as NonNullable<(typeof app.store.profiles)[number]>;

describe("coverage", () => {
  it("answers every route the web app can call, and no route twice", () => {
    const answered = new Set(app.routes.map((entry) => entry.route));
    const expected = Object.values(API_ROUTES).filter(
      (route) => route.module !== "worker-api",
    ) as RouteDef[];
    const missing = expected
      .filter((route) => !answered.has(route))
      .map((route) => `${route.method} ${route.path}`);
    expect(missing).toEqual([]);
    expect(app.routes.length).toBe(answered.size);
  });

  it("leaves the worker routes to the real server", async () => {
    const response = await call({ method: "POST", path: "/worker/claim", body: {} });
    expect(response.status).toBe(501);
    expect(response.json.error).toBe("not_implemented");
  });
});

describe("reads return data that matches the shared schemas", () => {
  // The mock validates every response and answers 500 when a handler breaks its schema, so a 200
  // here is the proof. The ids come from the fixtures.
  const params = () => ({
    id: jordan().id,
  });

  it("answers every parameterless GET", async () => {
    for (const route of Object.values(API_ROUTES)) {
      if (
        route.method !== "GET" ||
        route.path.includes(":") ||
        (route.module as string) === "worker-api"
      )
        continue;
      const response = await call({ path: route.path });
      expect(response.status, `${route.path} -> ${JSON.stringify(response.json)}`).toBe(200);
    }
  });

  it("answers the profile-scoped GETs", async () => {
    for (const route of [
      API_ROUTES.profilesGet,
      API_ROUTES.dashboardGet,
      API_ROUTES.requestsList,
      API_ROUTES.scansList,
      API_ROUTES.mailboxFolders,
    ]) {
      const response = await call({ path: buildRoutePath(route.path, params()) });
      expect(response.status, `${route.path} -> ${JSON.stringify(response.json)}`).toBe(200);
    }
  });

  it("answers the single-item GETs", async () => {
    const request = app.store.requests[0]?.id as string;
    const target = app.store.targets[0]?.id as string;
    expect((await call({ path: `/requests/${request}` })).status).toBe(200);
    expect((await call({ path: `/targets/${target}` })).status).toBe(200);
    expect((await call({ path: `/targets/facets` })).status).toBe(200);
  });

  it("has a screenshot for a task that says it has one, and none for one that does not", async () => {
    const withShot = app.store.tasks.find((task) => task.hasScreenshot);
    const without = app.store.tasks.find((task) => !task.hasScreenshot);
    expect(withShot).toBeDefined();
    const image = await call({ path: `/tasks/${withShot?.id}/screenshot` });
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(Array.from((image.raw as Uint8Array).slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect((await call({ path: `/tasks/${without?.id}/screenshot` })).status).toBe(404);
  });
});

describe("fixtures", () => {
  it("show every request status on the first profile, so every pill can be seen", () => {
    const seen = new Set(
      app.store.requests.filter((r) => r.profileId === jordan().id).map((r) => r.status),
    );
    expect([...seen].sort()).toEqual([...RequestStatus.options].sort());
  });

  it("contain only reserved example domains and no em dash", () => {
    const text = JSON.stringify(app.store, (_key, value) =>
      value instanceof Map ? [...value] : value,
    );
    const hosts = new Set<string>();
    for (const match of text.matchAll(/[\w.+-]+@([\w.-]+)/g))
      hosts.add((match[1] as string).toLowerCase());
    for (const host of hosts) {
      expect(host, `email host ${host}`).toMatch(/(^|\.)(example\.(com|org|net)|example)$/);
    }
    for (const match of text.matchAll(/https?:\/\/([^/"\s]+)/g)) {
      const host = (match[1] as string).toLowerCase().split(":")[0] as string;
      expect(host, `url host ${host}`).toMatch(/(^|\.)(example\.(com|org|net)|example|localhost)$/);
    }
    expect(text).not.toContain(EM_DASH);
  });

  it("are the same every time, so screenshots do not drift", () => {
    const again = createMockApp();
    expect(again.store.requests.map((request) => request.reference)).toEqual(
      app.store.requests.map((request) => request.reference),
    );
  });

  it("put parked tasks in the review queue", async () => {
    const queue = await call({ path: `/review?profileId=${jordan().id}` });
    expect(queue.json.blockedTasks.length).toBeGreaterThanOrEqual(3);
    expect(queue.json.matches.length).toBeGreaterThanOrEqual(2);
    expect(queue.json.messages.length).toBeGreaterThanOrEqual(2);
  });
});

describe("the server's rules", () => {
  it("answers 401 on a session route when signed out", async () => {
    await call({ method: "POST", path: "/auth/logout" });
    const response = await call({ path: "/profiles" });
    expect(response.status).toBe(401);
    expect(response.json.error).toBe("unauthorized");
  });

  it("answers 403 on a state-changing route without X-Kick-Rocks", async () => {
    const response = await call({ method: "POST", path: "/auth/logout", csrf: false });
    expect(response.status).toBe(403);
  });

  it("answers 400 with issues for a body that breaks the schema", async () => {
    const response = await call({
      method: "POST",
      path: "/auth/setup",
      body: { password: "short" },
    });
    expect(response.status).toBe(400);
    expect(response.json.issues[0].path).toEqual(["password"]);
  });

  it("answers 400 for a body that is not JSON", async () => {
    const response = await app.handle({
      method: "POST",
      url: "/api/auth/login",
      headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
      body: "{nope",
    });
    expect(response.status).toBe(400);
  });

  it("reads /targets/facets as the facets route, not as a target id", async () => {
    const response = await call({ path: "/targets/facets" });
    expect(response.json.kind).toBeDefined();
  });

  it("answers 404 for an unknown id", async () => {
    expect((await call({ path: "/requests/nope" })).status).toBe(404);
  });

  it("answers 500 when a fixture breaks the schema", async () => {
    const broken = createMockApp();
    const profile = broken.store.profiles[0] as NonNullable<(typeof broken.store.profiles)[number]>;
    (profile as { state: string }).state = "ZZ";
    const response = await broken.handle({
      method: "GET",
      url: `/api/profiles/${profile.id}`,
      headers: {},
      body: undefined,
    });
    expect(response.status).toBe(500);
    expect(JSON.parse(response.body as string).error).toBe("mock_contract_violation");
  });

  it("starts at the login page or setup when asked", async () => {
    const login = createMockApp({ auth: "login" });
    const state = await login.handle({
      method: "GET",
      url: "/api/auth/state",
      headers: {},
      body: undefined,
    });
    expect(JSON.parse(state.body as string)).toEqual({
      setupRequired: false,
      authenticated: false,
    });
    const setup = createMockApp({ auth: "setup" });
    const first = await setup.handle({
      method: "GET",
      url: "/api/auth/state",
      headers: {},
      body: undefined,
    });
    expect(JSON.parse(first.body as string)).toEqual({ setupRequired: true, authenticated: false });
  });
});

describe("auth", () => {
  it("signs in with the mock password, throttles wrong ones, and signs out", async () => {
    app = createMockApp({ auth: "login" });
    expect(
      (await call({ method: "POST", path: "/auth/login", body: { password: "nope" } })).status,
    ).toBe(401);
    expect(
      (await call({ method: "POST", path: "/auth/login", body: { password: "kickrocks-mock" } }))
        .status,
    ).toBe(200);
    expect((await call({ path: "/auth/state" })).json.authenticated).toBe(true);

    app = createMockApp({ auth: "login" });
    for (let attempt = 0; attempt < 5; attempt++) {
      await call({ method: "POST", path: "/auth/login", body: { password: "wrong" } });
    }
    expect(
      (await call({ method: "POST", path: "/auth/login", body: { password: "kickrocks-mock" } }))
        .status,
    ).toBe(429);
  });

  it("sets up the first password once", async () => {
    app = createMockApp({ auth: "setup" });
    expect(
      (
        await call({
          method: "POST",
          path: "/auth/setup",
          body: { password: "a long enough password" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call({
          method: "POST",
          path: "/auth/setup",
          body: { password: "another long password" },
        })
      ).status,
    ).toBe(409);
  });
});

describe("profiles and mailbox", () => {
  it("creates a profile and replaces its identities", async () => {
    const created = await call({
      method: "POST",
      path: "/profiles",
      body: {
        displayName: "Test Person",
        state: "OR",
        identities: [
          { kind: "name", value: { first: "Test", last: "Person" }, isPrimary: true },
          { kind: "email", value: { address: "test@example.com" }, isPrimary: true },
        ],
      },
    });
    expect(created.status).toBe(201);
    expect(created.json.primaryEmail).toBe("test@example.com");
    const list = await call({ path: "/profiles" });
    expect(list.json.profiles.length).toBe(4);
  });

  it("connects, tests, and removes a mailbox", async () => {
    const riley = app.store.profiles[1] as NonNullable<(typeof app.store.profiles)[number]>;
    const connection = {
      provider: "gmail",
      address: "riley@example.net",
      username: "riley@example.net",
      password: "app-password",
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
      smtpSecure: true,
      imapHost: "imap.gmail.com",
      imapPort: 993,
    };
    const ok = await call({
      method: "POST",
      path: `/profiles/${riley.id}/mailbox/test`,
      body: connection,
    });
    expect(ok.json.smtp.ok).toBe(true);
    const bad = await call({
      method: "POST",
      path: `/profiles/${riley.id}/mailbox/test`,
      body: { ...connection, password: "wrong" },
    });
    expect(bad.json.smtp.ok).toBe(false);

    const saved = await call({
      method: "PUT",
      path: `/profiles/${riley.id}/mailbox`,
      body: { ...connection, dailyCap: 100 },
    });
    expect(saved.status).toBe(200);
    expect(saved.json.replyFolder).toBe("INBOX");
    expect(saved.json).not.toHaveProperty("password");
    expect((await call({ path: `/profiles/${riley.id}` })).json.mailboxConnected).toBe(true);
    await call({ method: "DELETE", path: `/profiles/${riley.id}/mailbox` });
    expect((await call({ path: `/profiles/${riley.id}` })).json.mailboxConnected).toBe(false);
  });
});

describe("campaigns and requests", () => {
  it("previews and creates a campaign, skipping what is already active", async () => {
    const body = { selection: { preset: "email_brokers" }, rights: ["opt_out"] };
    const preview = await call({
      method: "POST",
      path: `/profiles/${jordan().id}/campaigns/preview`,
      body,
    });
    expect(preview.status).toBe(200);
    expect(preview.json.counts.request_created).toBeGreaterThan(0);
    expect(preview.json.counts.skipped).toBeGreaterThan(0);
    expect(preview.json.sampleEmail.subject).toContain("KR-");

    const before = (await call({ path: `/profiles/${jordan().id}/requests?pageSize=200` })).json
      .total;
    const created = await call({
      method: "POST",
      path: `/profiles/${jordan().id}/campaigns`,
      body,
    });
    expect(created.status).toBe(201);
    const after = (await call({ path: `/profiles/${jordan().id}/requests?pageSize=200` })).json
      .total;
    expect(after - before).toBe(created.json.counts.request_created);

    const again = await call({
      method: "POST",
      path: `/profiles/${jordan().id}/campaigns/preview`,
      body,
    });
    expect(again.json.counts.request_created).toBe(0);
  });

  it("starts a scan for a people-search target instead of sending a request", async () => {
    const riley = app.store.profiles[1] as NonNullable<(typeof app.store.profiles)[number]>;
    const body = { selection: { targetIds: ["peopletrace"] }, rights: ["delete"] };
    const preview = await call({
      method: "POST",
      path: `/profiles/${riley.id}/campaigns/preview`,
      body,
    });
    expect(preview.json.items[0].outcome).toBe("scan_started");
  });

  it("filters, searches, and pages the request list", async () => {
    const id = jordan().id;
    const sent = await call({ path: `/profiles/${id}/requests?status=sent,queued` });
    expect(
      sent.json.items.every((item: { status: string }) => ["sent", "queued"].includes(item.status)),
    ).toBe(true);
    const paged = await call({ path: `/profiles/${id}/requests?pageSize=5&page=2` });
    expect(paged.json.items.length).toBe(5);
    expect(paged.json.page).toBe(2);
    const found = await call({ path: `/profiles/${id}/requests?q=audience` });
    expect(found.json.total).toBe(1);
  });

  it("applies actions through the state machine", async () => {
    const queued = app.store.requests.find((request) => request.status === "queued") as NonNullable<
      (typeof app.store.requests)[number]
    >;
    const cancelled = await call({
      method: "POST",
      path: `/requests/${queued.id}/actions`,
      body: { action: "cancel" },
    });
    expect(cancelled.json.status).toBe("cancelled");
    expect(cancelled.json.events.at(-1).type).toBe("status_changed");
    const again = await call({
      method: "POST",
      path: `/requests/${queued.id}/actions`,
      body: { action: "mark_confirmed" },
    });
    expect(again.status).toBe(409);

    const bounced = app.store.requests.find(
      (request) => request.status === "bounced",
    ) as NonNullable<(typeof app.store.requests)[number]>;
    const resent = await call({
      method: "POST",
      path: `/requests/${bounced.id}/actions`,
      body: { action: "resend" },
    });
    expect(resent.json.status).toBe("queued");
  });

  it("shows the effect of a change on the dashboard", async () => {
    const id = jordan().id;
    const before = (await call({ path: `/profiles/${id}/dashboard` })).json;
    const waiting = app.store.requests.find(
      (request) => request.status === "awaiting_reply",
    ) as NonNullable<(typeof app.store.requests)[number]>;
    await call({
      method: "POST",
      path: `/requests/${waiting.id}/actions`,
      body: { action: "mark_confirmed" },
    });
    const after = (await call({ path: `/profiles/${id}/dashboard` })).json;
    expect(after.counts.confirmed).toBe(before.counts.confirmed + 1);
    expect(after.counts.awaiting_reply).toBe(before.counts.awaiting_reply - 1);
    expect(after.total).toBe(before.total);
    expect(Object.keys(after.counts).sort()).toEqual([...RequestStatus.options].sort());
  });
});

describe("review", () => {
  it("resumes, completes, and cancels blocked tasks", async () => {
    const blocked = app.store.tasks.filter((task) => task.status === "blocked");
    const [first, second, third] = blocked;
    expect(
      (await call({ method: "POST", path: `/tasks/${first?.id}/resume` })).json.task.status,
    ).toBe("queued");
    expect(
      (await call({ method: "POST", path: `/tasks/${second?.id}/mark-done` })).json.task.status,
    ).toBe("done");
    expect(
      (await call({ method: "POST", path: `/tasks/${third?.id}/cancel` })).json.task.status,
    ).toBe("cancelled");
    const queue = await call({ path: "/review" });
    expect(queue.json.blockedTasks.length).toBe(blocked.length - 3);
    expect((await call({ method: "POST", path: `/tasks/${first?.id}/resume` })).status).toBe(409);
  });

  it("turns a match decided as mine into a removal request", async () => {
    const match = app.store.matches.find(
      (candidate) => candidate.decision === "pending",
    ) as NonNullable<(typeof app.store.matches)[number]>;
    const decided = await call({
      method: "POST",
      path: `/matches/${match.id}/decision`,
      body: { decision: "mine" },
    });
    expect(decided.json.decision).toBe("mine");
    expect(decided.json.requestId).toBeTruthy();
    const request = await call({ path: `/requests/${decided.json.requestId}` });
    expect(request.json.recordUrl).toBe(match.recordUrl);
    expect(
      (
        await call({
          method: "POST",
          path: `/matches/${match.id}/decision`,
          body: { decision: "not_mine" },
        })
      ).status,
    ).toBe(409);
    const scans = await call({ path: `/profiles/${match.profileId}/scans` });
    const scan = scans.json.items.find((item: { id: string }) => item.id === match.scanId);
    expect(scan.matchCounts.mine).toBe(1);
  });

  it("classifies a message by hand and removes it from the queue", async () => {
    const message = app.store.messages.find((candidate) => !candidate.reviewed) as NonNullable<
      (typeof app.store.messages)[number]
    >;
    const request = app.store.requests[0] as NonNullable<(typeof app.store.requests)[number]>;
    const done = await call({
      method: "POST",
      path: `/messages/${message.id}/classification`,
      body: { classification: "auto_ack", requestId: request.id },
    });
    expect(done.json.classification).toBe("auto_ack");
    expect(done.json.requestId).toBe(request.id);
    const queue = await call({ path: "/review" });
    expect(queue.json.messages.some((item: { id: string }) => item.id === message.id)).toBe(false);
  });

  it("starts scans and refuses to double up", async () => {
    const id = jordan().id;
    const first = await call({
      method: "POST",
      path: `/profiles/${id}/scans`,
      body: { targetIds: ["homerecords"] },
    });
    expect(first.status).toBe(201);
    expect(first.json.items[0].outcome).toBe("scan_started");
    const second = await call({
      method: "POST",
      path: `/profiles/${id}/scans`,
      body: { targetIds: ["homerecords"] },
    });
    expect(second.json.items[0].reason).toBe("scan_in_progress");
  });
});

describe("settings and recipes", () => {
  it("patches the schedule and the LLM, and mints a token once", async () => {
    const patched = await call({
      method: "PATCH",
      path: "/settings",
      body: {
        schedule: { pollMinutes: 30 },
        llm: { baseUrl: "http://localhost:11434/v1", model: "llama3", apiKey: "secret" },
      },
    });
    expect(patched.json.schedule.pollMinutes).toBe(30);
    expect(patched.json.schedule.noResponseDays).toBe(45);
    expect(patched.json.llm).toEqual({
      baseUrl: "http://localhost:11434/v1",
      model: "llama3",
      apiKeySet: true,
    });
    expect(JSON.stringify(patched.json)).not.toContain("secret");

    const token = await call({ method: "POST", path: "/settings/mcp-token" });
    expect(token.json.token).toMatch(/^krmcp_[0-9a-f]{40}$/);
    expect((await call({ path: "/settings" })).json.mcp.tokenSet).toBe(true);
    expect(
      (await call({ method: "PATCH", path: "/settings", body: { llm: null } })).json.llm,
    ).toBeNull();
  });

  it("approves and rejects proposed recipes", async () => {
    const pending = await call({ path: "/recipes?status=pending_review" });
    expect(pending.json.recipes.length).toBeGreaterThanOrEqual(2);
    const [first, second] = pending.json.recipes;
    expect((await call({ method: "POST", path: `/recipes/${first.id}/approve` })).json.status).toBe(
      "active",
    );
    expect((await call({ method: "POST", path: `/recipes/${second.id}/reject` })).json.status).toBe(
      "rejected",
    );
    expect((await call({ method: "POST", path: `/recipes/${first.id}/approve` })).status).toBe(409);
  });

  it("lists data sources with how many targets carry each", async () => {
    const sources = await call({ path: "/settings/data-sources" });
    const counts = Object.fromEntries(
      sources.json.sources.map((source: { id: string; targetCount: number }) => [
        source.id,
        source.targetCount,
      ]),
    );
    expect(counts.badbool).toBeGreaterThan(0);
    expect(counts["kickrocks-companies"]).toBeGreaterThan(0);
  });
});

describe("reset", () => {
  it("puts the fixtures back", async () => {
    await call({
      method: "POST",
      path: `/requests/${app.store.requests[0]?.id}/actions`,
      body: { action: "cancel" },
    });
    app.reset();
    expect(app.store.requests[0]?.status).toBe("confirmed");
  });
});
