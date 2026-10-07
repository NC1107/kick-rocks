import { sessions } from "@kickrocks/db";
import { API_ROUTES, type RouteDef } from "@kickrocks/shared";
import type { LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, DAY, MINUTE, type TestContext } from "../../test-utils/index.js";
import { SESSION_COOKIE } from "./sessions.js";

const PASSWORD = "correct horse battery";
const OTHER_PASSWORD = "another long passphrase";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext({ auth: "real" });
});

afterEach(async () => {
  await ctx.close();
});

function cookieOf(response: LightMyRequestResponse, name = SESSION_COOKIE) {
  return response.cookies.find((cookie) => cookie.name === name);
}

function tokenOf(response: LightMyRequestResponse): string {
  const cookie = cookieOf(response);
  if (!cookie) throw new Error("no session cookie was set");
  return cookie.value;
}

const withSession = (token: string) => ({ cookie: `${SESSION_COOKIE}=${token}` });

function post(route: RouteDef, payload: unknown, headers: Record<string, string> = {}) {
  return ctx.inject({ method: route.method, url: `/api${route.path}`, payload, headers });
}

async function setUp(password = PASSWORD): Promise<string> {
  const response = await post(API_ROUTES.authSetup, { password });
  expect(response.statusCode).toBe(200);
  return tokenOf(response);
}

async function logIn(password = PASSWORD, headers: Record<string, string> = {}) {
  return post(API_ROUTES.authLogin, { password }, headers);
}

function stateOf(token?: string) {
  return ctx.inject({
    url: "/api/auth/state",
    ...(token ? { headers: withSession(token) } : {}),
  });
}

describe("auth state and setup", () => {
  it("asks for setup until a password exists, and reports no session to a stranger", async () => {
    const response = await stateOf();
    expect(response.json()).toEqual({ setupRequired: true, authenticated: false });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets the password once, signs the caller in, and refuses a second setup", async () => {
    const token = await setUp();
    expect((await stateOf(token)).json()).toEqual({ setupRequired: false, authenticated: true });

    const again = await post(API_ROUTES.authSetup, { password: OTHER_PASSWORD });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("setup_already_done");
    expect((await logIn(OTHER_PASSWORD)).statusCode).toBe(401);
    expect((await logIn()).statusCode).toBe(200);
  });

  it("lets only one of two simultaneous setups win", async () => {
    const [first, second] = await Promise.all([
      post(API_ROUTES.authSetup, { password: PASSWORD }),
      post(API_ROUTES.authSetup, { password: OTHER_PASSWORD }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
  });

  it("rejects a short or missing password with body issues", async () => {
    const short = await post(API_ROUTES.authSetup, { password: "short" });
    expect(short.statusCode).toBe(400);
    expect(short.json().issues[0].path).toEqual(["body", "password"]);
    expect((await post(API_ROUTES.authSetup, {})).statusCode).toBe(400);
    expect((await stateOf()).json().setupRequired).toBe(true);
  });

  it("stores the password as an argon2id hash and the session as the hash of its token", async () => {
    const token = await setUp();
    const hash = ctx.services.settings.get("auth.passwordHash");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain(PASSWORD);

    const rows = ctx.services.db.select().from(sessions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(ctx.services.secrets.hashToken(token));
    expect(rows[0]?.id).not.toBe(token);
  });
});

describe("session cookie", () => {
  it("is HttpOnly, SameSite=Strict, scoped to the site, and lasts 30 days", async () => {
    const response = await post(API_ROUTES.authSetup, { password: PASSWORD });
    const cookie = cookieOf(response);
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    expect(cookie?.secure).toBeFalsy();
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is marked Secure when the public URL is https", async () => {
    await ctx.close();
    ctx = await createTestContext({
      auth: "real",
      env: { KICKROCKS_PUBLIC_URL: "https://kickrocks.example.org" },
    });
    expect(cookieOf(await post(API_ROUTES.authSetup, { password: PASSWORD }))?.secure).toBe(true);
  });

  it("gives every login its own token", async () => {
    const first = await setUp();
    const second = tokenOf(await logIn());
    expect(second).not.toBe(first);
    expect((await stateOf(first)).json().authenticated).toBe(true);
    expect((await stateOf(second)).json().authenticated).toBe(true);
  });
});

describe("the guard with real sessions", () => {
  it("turns away an anonymous call to a session route", async () => {
    await setUp();
    const response = await ctx.inject({ url: "/api/profiles" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("unauthorized");
  });

  it("lets a signed-in call through, and an unknown or malformed cookie does not", async () => {
    const token = await setUp();
    expect(
      (await ctx.inject({ url: "/api/profiles", headers: withSession(token) })).statusCode,
    ).toBe(200);
    for (const bad of ["x", "A".repeat(43), `${token}x`, token.slice(1), ""]) {
      const response = await ctx.inject({ url: "/api/profiles", headers: withSession(bad) });
      expect(response.statusCode, bad).toBe(401);
    }
  });

  it("answers 401 before setup, too, rather than leaving the API open", async () => {
    expect((await ctx.inject({ url: "/api/profiles" })).statusCode).toBe(401);
    expect((await ctx.inject({ url: "/api/settings" })).statusCode).toBe(401);
  });

  it("requires the CSRF header on a state-changing call even with a valid session", async () => {
    const token = await setUp();
    const withoutHeader = await ctx.inject({
      method: "POST",
      url: "/api/profiles",
      payload: {},
      headers: withSession(token),
      csrf: false,
    });
    expect(withoutHeader.statusCode).toBe(403);
    expect(withoutHeader.json().error).toBe("forbidden");
  });

  it("requires the CSRF header on the auth routes before reading their body", async () => {
    for (const route of [API_ROUTES.authSetup, API_ROUTES.authLogin, API_ROUTES.authLogout]) {
      const response = await ctx.inject({
        method: "POST",
        url: `/api${route.path}`,
        payload: { password: PASSWORD },
        csrf: false,
      });
      expect(response.statusCode, route.path).toBe(403);
    }
    expect((await stateOf()).json().setupRequired).toBe(true);
  });

  it("does not need the header for a read", async () => {
    const token = await setUp();
    const response = await ctx.inject({
      url: "/api/profiles",
      headers: withSession(token),
      csrf: false,
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("login", () => {
  it("answers the same way for a wrong password and for an instance with no password", async () => {
    const before = await logIn("whatever-it-is");
    expect(before.statusCode).toBe(401);
    expect(cookieOf(before)).toBeUndefined();

    await setUp();
    const wrong = await logIn("not the password");
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual(before.json());
    expect(cookieOf(wrong)).toBeUndefined();
  });

  it("rejects an empty or oversized password as a validation error", async () => {
    await setUp();
    expect((await logIn("")).statusCode).toBe(400);
    expect((await logIn("x".repeat(257))).statusCode).toBe(400);
  });

  it("signs in with the right password", async () => {
    await setUp();
    const response = await logIn();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect((await stateOf(tokenOf(response))).json().authenticated).toBe(true);
  });

  it("rehashes a password hashed with weaker parameters after a successful login", async () => {
    await setUp();
    const argon2 = (await import("argon2")).default;
    const weak = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      timeCost: 1,
      memoryCost: 8192,
    });
    ctx.services.settings.set("auth.passwordHash", weak);
    expect((await logIn()).statusCode).toBe(200);
    const upgraded = ctx.services.settings.get("auth.passwordHash");
    expect(upgraded).not.toBe(weak);
    expect((await logIn()).statusCode).toBe(200);
  });

  it("treats a corrupt stored hash as a wrong password", async () => {
    await setUp();
    ctx.services.settings.set("auth.passwordHash", "not-a-hash");
    expect((await logIn()).statusCode).toBe(401);
  });
});

describe("login throttling", () => {
  async function failTimes(count: number, headers: Record<string, string> = {}) {
    for (let i = 0; i < count; i += 1) {
      expect((await logIn("wrong password here", headers)).statusCode).toBe(401);
    }
  }

  it("locks out an address after five wrong passwords, even for the right one", async () => {
    await setUp();
    await failTimes(4);
    expect((await logIn("wrong password here")).statusCode).toBe(401);

    const locked = await logIn();
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toBe("rate_limited");
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
    expect(cookieOf(locked)).toBeUndefined();
  });

  it("lets the address back in once the lockout has passed, and doubles it on the next miss", async () => {
    await setUp();
    await failTimes(5);
    expect((await logIn()).statusCode).toBe(429);

    ctx.clock.advance(29_000);
    expect((await logIn()).statusCode).toBe(429);
    ctx.clock.advance(2_000);
    expect((await logIn("wrong password here")).statusCode).toBe(401);

    const second = await logIn();
    expect(second.statusCode).toBe(429);
    expect(Number(second.headers["retry-after"])).toBeGreaterThan(30);
  });

  it("caps the lockout at fifteen minutes", async () => {
    await setUp();
    for (let round = 0; round < 12; round += 1) {
      ctx.clock.advance(16 * MINUTE);
      await failTimes(1);
    }
    ctx.clock.advance(16 * MINUTE);
    await failTimes(1);
    const locked = await logIn();
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers["retry-after"])).toBe(15 * 60);
  });

  it("forgets earlier misses after a quiet hour", async () => {
    await setUp();
    await failTimes(4);
    ctx.clock.advance(61 * MINUTE);
    await failTimes(4);
    expect((await logIn()).statusCode).toBe(200);
  });

  it("clears the count when the right password is used", async () => {
    await setUp();
    await failTimes(4);
    expect((await logIn()).statusCode).toBe(200);
    await failTimes(4);
    expect((await logIn()).statusCode).toBe(200);
  });

  it("counts a burst of parallel guesses against the same limit", async () => {
    await setUp();
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => logIn("wrong password here")),
    );
    const statuses = responses.map((response) => response.statusCode);
    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(7);
  });

  it("tracks each address on its own", async () => {
    await setUp();
    await failTimes(5);
    expect((await logIn()).statusCode).toBe(429);
    const other = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: PASSWORD },
      headers: { "x-kick-rocks": "1" },
      remoteAddress: "10.9.8.7",
    });
    expect(other.statusCode).toBe(200);
  });
});

describe("expiry and logout", () => {
  it("slides the session's expiry while it is used, and the cookie with it on the state call", async () => {
    const token = await setUp();
    ctx.clock.advance(20 * DAY);
    expect(
      (await ctx.inject({ url: "/api/profiles", headers: withSession(token) })).statusCode,
    ).toBe(200);
    ctx.clock.advance(20 * DAY);
    const state = await stateOf(token);
    expect(state.json().authenticated).toBe(true);
    expect(cookieOf(state)?.value).toBe(token);
    expect(cookieOf(state)?.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("ends a session left idle for 30 days and removes its row", async () => {
    const token = await setUp();
    ctx.clock.advance(30 * DAY + MINUTE);
    const response = await ctx.inject({ url: "/api/profiles", headers: withSession(token) });
    expect(response.statusCode).toBe(401);
    expect(ctx.services.db.select().from(sessions).all()).toHaveLength(0);
    expect((await stateOf(token)).json().authenticated).toBe(false);
  });

  it("does not write to the database on every request", async () => {
    const token = await setUp();
    const before = ctx.services.db.select().from(sessions).get();
    ctx.clock.advance(10_000);
    await ctx.inject({ url: "/api/profiles", headers: withSession(token) });
    expect(ctx.services.db.select().from(sessions).get()).toEqual(before);
  });

  it("logs out by destroying the session on the server and clearing the cookie", async () => {
    const token = await setUp();
    const response = await post(API_ROUTES.authLogout, undefined, withSession(token));
    expect(response.statusCode).toBe(200);
    expect(cookieOf(response)).toMatchObject({ value: "", path: "/" });
    expect(
      (await ctx.inject({ url: "/api/profiles", headers: withSession(token) })).statusCode,
    ).toBe(401);
  });

  it("logs out quietly with no session", async () => {
    const response = await post(API_ROUTES.authLogout, undefined);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("keeps other sessions alive when one logs out", async () => {
    const first = await setUp();
    const second = tokenOf(await logIn());
    await post(API_ROUTES.authLogout, undefined, withSession(first));
    expect((await stateOf(second)).json().authenticated).toBe(true);
  });

  it("caps how many sessions are kept, dropping the least recently used", async () => {
    const first = await setUp();
    for (let i = 0; i < 100; i += 1) {
      ctx.clock.advance(1000);
      tokenOf(await logIn());
    }
    expect(ctx.services.db.select().from(sessions).all().length).toBeLessThanOrEqual(100);
    expect((await stateOf(first)).json().authenticated).toBe(false);
  });
});

describe("password change", () => {
  const change = (token: string, currentPassword: string, newPassword: string) =>
    post(API_ROUTES.authPassword, { currentPassword, newPassword }, withSession(token));

  it("needs a session", async () => {
    await setUp();
    const response = await post(API_ROUTES.authPassword, {
      currentPassword: PASSWORD,
      newPassword: OTHER_PASSWORD,
    });
    expect(response.statusCode).toBe(401);
  });

  it("changes the password, signs out every other session, and rotates this one", async () => {
    const mine = await setUp();
    const other = tokenOf(await logIn());

    const response = await change(mine, PASSWORD, OTHER_PASSWORD);
    expect(response.statusCode).toBe(200);
    const fresh = tokenOf(response);

    expect(fresh).not.toBe(mine);
    expect((await stateOf(mine)).json().authenticated).toBe(false);
    expect((await stateOf(other)).json().authenticated).toBe(false);
    expect((await stateOf(fresh)).json().authenticated).toBe(true);
    expect((await logIn(PASSWORD)).statusCode).toBe(401);
    expect((await logIn(OTHER_PASSWORD)).statusCode).toBe(200);
  });

  it("answers 403, not 401, for a wrong current password so the web app stays signed in", async () => {
    const token = await setUp();
    const response = await change(token, "not the password", OTHER_PASSWORD);
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("forbidden");
    expect((await stateOf(token)).json().authenticated).toBe(true);
    expect((await logIn()).statusCode).toBe(200);
  });

  it("refuses a new password that is too short or unchanged", async () => {
    const token = await setUp();
    const short = await change(token, PASSWORD, "short");
    expect(short.statusCode).toBe(400);
    expect(short.json().issues[0].path).toEqual(["body", "newPassword"]);

    const same = await change(token, PASSWORD, PASSWORD);
    expect(same.statusCode).toBe(400);
    expect(same.json().issues[0].path).toEqual(["body", "newPassword"]);
  });

  it("throttles guesses at the current password, and the lockout does not touch login", async () => {
    const token = await setUp();
    for (let i = 0; i < 5; i += 1) {
      expect((await change(token, "wrong password here", OTHER_PASSWORD)).statusCode).toBe(403);
    }
    const locked = await change(token, PASSWORD, OTHER_PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect((await logIn()).statusCode).toBe(200);
  });
});

describe("security headers on the auth routes", () => {
  it("never lets a response that sets a session be cached", async () => {
    const response = await post(API_ROUTES.authSetup, { password: PASSWORD });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect((await logIn()).headers["cache-control"]).toBe("no-store");
  });
});
