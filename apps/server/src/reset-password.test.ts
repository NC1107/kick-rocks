import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPassword } from "./reset-password.js";
import { createTestContext, seedProfile, type TestContext } from "./test-utils/index.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext({ auth: "real" });
});

afterEach(async () => {
  await ctx.close();
});

const PASSWORD = "correct horse battery";

describe("reset-password", () => {
  it("signs everyone out and asks for a new password, and keeps the person's data", async () => {
    const setup = await ctx.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { password: PASSWORD },
    });
    const cookie = `${setup.cookies[0]?.name}=${setup.cookies[0]?.value}`;
    const profile = seedProfile(ctx);

    resetPassword(ctx.services.db, ctx.clock);

    const state = await ctx.inject({ url: "/api/auth/state", headers: { cookie } });
    expect(state.json()).toEqual({ setupRequired: true, authenticated: false });
    const again = await ctx.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { password: "another long passphrase" },
    });
    expect(again.statusCode).toBe(200);
    const profiles = await ctx.inject({
      url: "/api/profiles",
      headers: { cookie: `${again.cookies[0]?.name}=${again.cookies[0]?.value}` },
    });
    expect(JSON.stringify(profiles.json())).toContain(profile.id);
  });
});
