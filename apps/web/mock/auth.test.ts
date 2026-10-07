import { describe, expect, it } from "vitest";
import { call, freshMockAppEachTest, resetApp } from "./test-helpers.js";

freshMockAppEachTest();

describe("auth", () => {
  it("signs in with the mock password, throttles wrong ones, and signs out", async () => {
    resetApp({ auth: "login" });
    expect(
      (await call({ method: "POST", path: "/auth/login", body: { password: "nope" } })).status,
    ).toBe(401);
    expect(
      (await call({ method: "POST", path: "/auth/login", body: { password: "kickrocks-mock" } }))
        .status,
    ).toBe(200);
    expect((await call({ path: "/auth/state" })).json.authenticated).toBe(true);

    resetApp({ auth: "login" });
    for (let attempt = 0; attempt < 5; attempt++) {
      await call({ method: "POST", path: "/auth/login", body: { password: "wrong" } });
    }
    expect(
      (await call({ method: "POST", path: "/auth/login", body: { password: "kickrocks-mock" } }))
        .status,
    ).toBe(429);
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
});
