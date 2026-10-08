import * as realLegal from "@kickrocks/legal";
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
    ctx.legal.getLegalBasis = (id, state, rights, asOf) => {
      const basis = getLegalBasis(id, state, rights, asOf);
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

  it("gives a Delete Act request sent on or after 2027-01-01 a 30 day window", () => {
    ctx.legal.getLegalBasis = realLegal.getLegalBasis;
    const profile = seedProfile(ctx, { state: "CA" });
    const request = {
      profileId: profile.id,
      legalBasis: "ca-delete-act",
      rights: ["delete" as const],
    };
    const before = new Date("2026-12-31T00:00:00Z");
    const after = new Date("2027-01-01T00:00:00Z");

    expect(Date.parse(responseWindow(ctx.services, request, before).dueAt) - before.getTime()).toBe(
      45 * DAY,
    );
    expect(Date.parse(responseWindow(ctx.services, request, after).dueAt) - after.getTime()).toBe(
      30 * DAY,
    );
  });
});
