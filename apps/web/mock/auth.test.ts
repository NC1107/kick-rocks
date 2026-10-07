import { describe, expect, it } from "vitest";
import { call, freshMockAppEachTest, resetApp } from "./test-helpers.js";

freshMockAppEachTest();

const login = (password: string) =>
  call({ method: "POST", path: "/auth/login", body: { password } });

describe("auth", () => {
  it("signs in with the mock password, throttles wrong ones, and signs out", async () => {
    resetApp({ auth: "login" });
    expect((await login("nope")).status).toBe(401);
    expect((await login("kickrocks-mock")).status).toBe(200);
    expect((await call({ path: "/auth/state" })).json.authenticated).toBe(true);

    resetApp({ auth: "login" });
    for (let attempt = 0; attempt < 5; attempt++) await login("wrong");
    expect((await login("kickrocks-mock")).status).toBe(429);
  });

  it("sets up the first password once", async () => {
    resetApp({ auth: "setup" });
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

  it("refuses a short first password with the issue on the password", async () => {
    resetApp({ auth: "setup" });
    const response = await call({
      method: "POST",
      path: "/auth/setup",
      body: { password: "short" },
    });
    expect(response.status).toBe(400);
    expect(response.json.issues[0].path).toEqual(["body", "password"]);
  });

  it("reports whether setup is needed and whether this browser is signed in", async () => {
    resetApp({ auth: "setup" });
    expect((await call({ path: "/auth/state" })).json).toEqual({
      setupRequired: true,
      authenticated: false,
    });
    resetApp({ auth: "login" });
    expect((await call({ path: "/auth/state" })).json).toEqual({
      setupRequired: false,
      authenticated: false,
    });
  });

  it("signs in after setup and out again", async () => {
    resetApp({ auth: "setup" });
    await call({
      method: "POST",
      path: "/auth/setup",
      body: { password: "a long enough password" },
    });
    expect((await call({ path: "/auth/state" })).json.authenticated).toBe(true);
    await call({ method: "POST", path: "/auth/logout" });
    expect((await call({ path: "/auth/state" })).json.authenticated).toBe(false);
    expect((await login("a long enough password")).status).toBe(200);
  });

  it("clears the throttle after a right password", async () => {
    resetApp({ auth: "login" });
    for (let attempt = 0; attempt < 4; attempt++) await login("wrong");
    expect((await login("kickrocks-mock")).status).toBe(200);
    await call({ method: "POST", path: "/auth/logout" });
    for (let attempt = 0; attempt < 4; attempt++) expect((await login("wrong")).status).toBe(401);
  });

  it("changes the password only with the current one", async () => {
    expect(
      (
        await call({
          method: "POST",
          path: "/auth/password",
          body: { currentPassword: "wrong", newPassword: "a brand new password" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call({
          method: "POST",
          path: "/auth/password",
          body: { currentPassword: "kickrocks-mock", newPassword: "a brand new password" },
        })
      ).status,
    ).toBe(200);
    await call({ method: "POST", path: "/auth/logout" });
    expect((await login("a brand new password")).status).toBe(200);
  });
});
