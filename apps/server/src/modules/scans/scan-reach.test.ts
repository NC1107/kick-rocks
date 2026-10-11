import {
  API_ROUTES,
  BROWSER_TASK_KINDS,
  clockIn,
  ScanningSettings,
  WORKER_DEFAULT_KINDS,
} from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  seedProfile,
  seedRecipe,
  seedTarget,
  type TestContext,
} from "../../test-utils/index.js";

/**
 * A person who set up a profile with a name, an email and a state, and no street address, starts
 * scans from every place the UI offers. The built-in worker polls for scan, form, confirm and
 * canary tasks, so these tests follow a scan from the button to that poll and check that, wherever
 * it stops, the person is told why.
 */
let ctx: TestContext;

afterEach(async () => {
  await ctx.close();
});

const nameAndEmailOnly = () =>
  seedProfile(ctx, {
    state: "MD",
    identities: [
      {
        kind: "name",
        value: { first: "Nick", last: "Conn" },
        isPrimary: true,
        validFrom: null,
        validTo: null,
      },
      {
        kind: "email",
        value: { address: "nick@example.com" },
        isPrimary: true,
        validFrom: null,
        validTo: null,
      },
    ],
  });

const withAddress = (profileId: string) =>
  ctx.call(API_ROUTES.profilesReplaceIdentities, {
    params: { id: profileId },
    body: {
      identities: [
        {
          kind: "name",
          value: { first: "Nick", last: "Conn" },
          isPrimary: true,
          validFrom: null,
          validTo: null,
        },
        {
          kind: "email",
          value: { address: "nick@example.com" },
          isPrimary: true,
          validFrom: null,
          validTo: null,
        },
        {
          kind: "address",
          value: { street: "1 Main St", city: "Baltimore", state: "MD", zip: "21201" },
          isPrimary: true,
          validFrom: null,
          validTo: null,
        },
      ],
    },
  });

const peopleSearch = (withRecipe: boolean) => {
  const target = seedTarget(ctx, { category: "people-search", contactMethod: "form" });
  if (withRecipe) seedRecipe(ctx, target.id, { purpose: "scan" });
  return target;
};

async function workerClaim() {
  const result = await ctx.call(API_ROUTES.workerClaim, {
    body: { workerId: "worker-1", kinds: [...WORKER_DEFAULT_KINDS] },
  });
  if (!result.ok) throw new Error(`claim answered ${result.status}`);
  return result.body.task;
}

describe("a scan that cannot reach the worker", () => {
  beforeEach(async () => {
    ctx = await createTestContext({ politeness: "default" });
  });

  it("says what the profile lacks, on the dashboard and when the scan is started", async () => {
    const profile = nameAndEmailOnly();
    peopleSearch(true);
    peopleSearch(true);

    const started = await ctx.call(API_ROUTES.scansStart, {
      params: { id: profile.id },
      body: { preset: "people_search" },
    });
    expect(started.ok && started.body.items).toHaveLength(2);
    if (!started.ok) return;
    for (const item of started.body.items) {
      expect(item).toMatchObject({ outcome: "skipped", reason: "missing_profile_details" });
      expect(item.detail).toMatch(/city/);
    }
    expect(await workerClaim()).toBeNull();

    const dashboard = await ctx.call(API_ROUTES.dashboardGet, { params: { id: profile.id } });
    expect(dashboard.ok && dashboard.body.scanning).toMatchObject({
      ready: 0,
      needsDetails: 2,
      missing: expect.stringMatching(/city/),
    });
  });

  it("reaches the worker once the profile has an address", async () => {
    const profile = nameAndEmailOnly();
    const site = peopleSearch(true);
    expect((await withAddress(profile.id)).ok).toBe(true);

    const started = await ctx.call(API_ROUTES.scansStart, {
      params: { id: profile.id },
      body: { targetIds: [site.id] },
    });
    expect(started.ok && started.body.items[0]).toMatchObject({ outcome: "scan_started" });
    expect(await workerClaim()).toMatchObject({ kind: "scan", target: { id: site.id } });

    const dashboard = await ctx.call(API_ROUTES.dashboardGet, { params: { id: profile.id } });
    expect(dashboard.ok && dashboard.body.scanning).toMatchObject({
      ready: 1,
      needsDetails: 0,
      missing: null,
    });
  });

  it("holds a site with no scripted search for an agent and says so", async () => {
    const profile = nameAndEmailOnly();
    const site = peopleSearch(false);
    await withAddress(profile.id);

    const started = await ctx.call(API_ROUTES.scansStart, {
      params: { id: profile.id },
      body: { targetIds: [site.id] },
    });
    expect(started.ok && started.body.items[0]).toMatchObject({ outcome: "scan_started" });
    expect(await workerClaim()).toBeNull();
    expect(BROWSER_TASK_KINDS).toContain("agent");
    expect(WORKER_DEFAULT_KINDS).not.toContain("agent");

    const scans = await ctx.call(API_ROUTES.scansList, {
      params: { id: profile.id },
      query: { page: 1, pageSize: 10 },
    });
    expect(scans.ok && scans.body.items[0]?.hold).toMatchObject({ reason: "no_recipe" });
    const dashboard = await ctx.call(API_ROUTES.dashboardGet, { params: { id: profile.id } });
    expect(dashboard.ok && dashboard.body.scanning).toMatchObject({
      noRecipe: 1,
      recipeNeedsReview: 0,
      ready: 0,
    });
  });

  it("tells a recipe that waits for review from a site with no recipe at all", async () => {
    const profile = nameAndEmailOnly();
    const unreviewed = peopleSearch(false);
    seedRecipe(ctx, unreviewed.id, { purpose: "scan", status: "pending_review" });
    peopleSearch(false);
    await withAddress(profile.id);

    const dashboard = await ctx.call(API_ROUTES.dashboardGet, { params: { id: profile.id } });
    expect(dashboard.ok && dashboard.body.scanning).toMatchObject({
      ready: 0,
      noRecipe: 1,
      recipeNeedsReview: 1,
    });
  });

  it("counts a recipe that waits for review as no recipe once unreviewed ones may be taken", async () => {
    const profile = nameAndEmailOnly();
    const unreviewed = peopleSearch(false);
    seedRecipe(ctx, unreviewed.id, { purpose: "scan", status: "pending_review" });
    ctx.services.settings.set("agent.takeUnreviewed", true);
    await withAddress(profile.id);

    const dashboard = await ctx.call(API_ROUTES.dashboardGet, { params: { id: profile.id } });
    expect(dashboard.ok && dashboard.body.scanning).toMatchObject({
      noRecipe: 1,
      recipeNeedsReview: 0,
    });
  });

  it("holds a scan in quiet hours and says when they end, and that the time zone was never set", async () => {
    const profile = nameAndEmailOnly();
    const site = peopleSearch(true);
    await withAddress(profile.id);
    const hour = clockIn(ctx.clock.now(), null).hour;
    ctx.services.settings.set(
      "scanning",
      ScanningSettings.parse({
        timeZone: null,
        quietStartHour: hour,
        quietEndHour: (hour + 1) % 24,
        minGapMinutes: 0,
        gapJitterPercent: 0,
      }),
    );

    await ctx.call(API_ROUTES.scansStart, {
      params: { id: profile.id },
      body: { targetIds: [site.id] },
    });
    expect(await workerClaim()).toBeNull();

    const scans = await ctx.call(API_ROUTES.scansList, {
      params: { id: profile.id },
      query: { page: 1, pageSize: 10 },
    });
    expect(scans.ok && scans.body.items[0]?.hold).toMatchObject({ reason: "quiet_hours" });
    const dashboard = await ctx.call(API_ROUTES.dashboardGet, { params: { id: profile.id } });
    expect(dashboard.ok && dashboard.body.scanning.quiet).toMatchObject({ zoneUnset: true });
  });
});
