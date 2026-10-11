import { API_ROUTES } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  seedProfile,
  seedRecipe,
  seedTarget,
  type TestContext,
} from "../../test-utils/index.js";

let ctx: TestContext;
let profileId: string;

beforeEach(async () => {
  ctx = await createTestContext({ politeness: "default" });
  profileId = seedProfile(ctx).id;
});

afterEach(async () => {
  await ctx.close();
});

/** Makes the current hour the only quiet hour, in the zone the server reads it in. */
function quietNow(timeZone: "UTC" | null) {
  const hour = timeZone === "UTC" ? ctx.clock.now().getUTCHours() : ctx.clock.now().getHours();
  ctx.services.settings.set("scanning", {
    ...ctx.services.settings.get("scanning"),
    timeZone,
    quietStartHour: hour,
    quietEndHour: (hour + 1) % 24,
    reuseHours: 0,
  });
}

function startScan(withRecipe: boolean) {
  const site = seedTarget(ctx, { category: "people-search", contactMethod: "form" });
  if (withRecipe) seedRecipe(ctx, site.id, { purpose: "scan" });
  const task = ctx.services.dispatch.enqueueScan(profileId, site.id).task;
  return { site, task };
}

async function listScans() {
  const result = await ctx.call(API_ROUTES.scansList, { params: { id: profileId } });
  if (!result.ok) throw new Error("scans did not list");
  return result.body.items;
}

describe("why a queued scan is not starting", () => {
  it("says quiet hours are read on the server clock when no time zone is set", async () => {
    quietNow(null);
    const { site } = startScan(true);

    const [scan] = await listScans();

    expect(scan).toMatchObject({ targetId: site.id, taskStatus: "queued" });
    expect(scan?.hold).toMatchObject({
      reason: "quiet_hours",
      serverClock: true,
      detail: expect.stringContaining("server clock"),
    });
    expect(scan?.hold?.until).toBeTruthy();
  });

  it("does not blame the server clock once a time zone is chosen", async () => {
    quietNow("UTC");
    startScan(true);

    const [scan] = await listScans();

    expect(scan?.hold).toMatchObject({ reason: "quiet_hours" });
    expect(scan?.hold?.serverClock).toBeUndefined();
  });

  it("has no hold for a scan nothing is holding back", async () => {
    startScan(true);

    const [scan] = await listScans();

    expect(scan?.hold).toBeNull();
  });

  it("says a site with no recipe waits for a connected agent", async () => {
    startScan(false);

    const [scan] = await listScans();

    expect(scan?.hold).toMatchObject({ reason: "no_recipe" });
  });

  it("counts the held scans by reason on the dashboard", async () => {
    quietNow(null);
    startScan(true);
    startScan(true);
    startScan(false);

    const result = await ctx.call(API_ROUTES.dashboardGet, { params: { id: profileId } });
    if (!result.ok) throw new Error("dashboard did not load");

    expect(result.body.scans).toMatchObject({
      queued: 3,
      held: 3,
      byReason: {
        quiet_hours: { count: 2, serverClock: true },
        no_recipe: { count: 1 },
      },
    });
  });
});
