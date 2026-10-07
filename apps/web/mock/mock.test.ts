import {
  API_ROUTES,
  buildRoutePath,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  type RouteDef,
} from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { createMockApp } from "./app.js";
import { app, call, freshMockAppEachTest, jordan } from "./test-helpers.js";

// Written by code point so this file does not contain the character it forbids.
const EM_DASH = String.fromCodePoint(0x2014);

/*
 * Only what holds for the mock as a whole: coverage, the server's rules, reserved domains, and
 * determinism. What a domain's handlers do is tested next to that domain, in mock/<domain>.test.ts,
 * so the page agent that owns the handlers owns their tests.
 */
freshMockAppEachTest();

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
    expect(response.json.issues[0].path).toEqual(["body", "password"]);
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
