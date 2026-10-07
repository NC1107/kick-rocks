import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, DAY, seedProfile, type TestContext } from "../test-utils/index.js";
import { responseWindow } from "./deadlines.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

describe("responseWindow", () => {
  it("asks the legal package for the window of the rights the request made", () => {
    const profile = seedProfile(ctx, { state: "CA" });
    const getLegalBasis = ctx.legal.getLegalBasis.bind(ctx.legal);
    ctx.legal.getLegalBasis = (id, state, rights) => {
      const basis = getLegalBasis(id, state, rights);
      const optsOutOnly = rights?.every((right) => right === "opt_out") ?? false;
      return basis && { ...basis, responseDays: optsOutOnly ? 21 : 45 };
    };
    const sentAt = new Date("2026-10-01T00:00:00Z");
    const request = { profileId: profile.id, legalBasis: "policy" };

    const optOut = responseWindow(ctx.services, { ...request, rights: ["opt_out"] }, sentAt);
    const both = responseWindow(
      ctx.services,
      { ...request, rights: ["opt_out", "delete"] },
      sentAt,
    );

    expect(Date.parse(optOut.dueAt) - sentAt.getTime()).toBe(21 * DAY);
    expect(Date.parse(both.dueAt) - sentAt.getTime()).toBe(45 * DAY);
  });
});
