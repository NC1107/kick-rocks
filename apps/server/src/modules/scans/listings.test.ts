import { matches, requests, scans, tasks } from "@kickrocks/db";
import {
  API_ROUTES,
  type ListingStatus,
  type RouteBodyInput,
  ScanningSettings,
} from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enqueueDueRescans } from "../../scheduler/rescans.js";
import {
  createTestContext,
  DAY,
  jordanIdentities,
  seedMatch,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedScan,
  seedTarget,
  type TestContext,
} from "../../test-utils/index.js";

let ctx: TestContext;
let profileId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
});

afterEach(async () => {
  await ctx.close();
});

const site = () => seedTarget(ctx, { category: "people-search", contactMethod: "form" });
const now = () => ctx.clock.now().toISOString();

const list = async (query: { status?: string } = {}) => {
  const result = await ctx.call(API_ROUTES.listingsList, {
    params: { id: profileId },
    query: query as never,
  });
  if (!result.ok) throw new Error(`listings failed: ${JSON.stringify(result.body)}`);
  return result.body;
};

const statusOf = async (targetId: string): Promise<ListingStatus | undefined> =>
  (await list()).items.find((item) => item.targetId === targetId)?.status;

const start = (body: RouteBodyInput<typeof API_ROUTES.scansStart>) =>
  ctx.call(API_ROUTES.scansStart, { params: { id: profileId }, body });

const prefer = (targetId: string, body: RouteBodyInput<typeof API_ROUTES.listingsPreference>) =>
  ctx.call(API_ROUTES.listingsPreference, { params: { id: profileId, targetId }, body });

describe("scanning without a campaign", () => {
  it("starts a scan from a site alone and lists it as waiting", async () => {
    const target = site();
    expect(await statusOf(target.id)).toBe("not_scanned");

    const started = await start({ targetIds: [target.id] });
    expect(started.ok && started.body.items[0]?.outcome).toBe("scan_started");

    expect(await statusOf(target.id)).toBe("waiting");
    const row = (await list()).items.find((item) => item.targetId === target.id);
    expect(row?.latestScan?.taskStatus).toBe("queued");
    expect(
      ctx.services.taskQueue.list({ profileId }).every((task) => task.requestId === null),
    ).toBe(true);
  });

  it("opens the removal for a record from the finding itself", async () => {
    const target = site();
    const scan = seedScan(ctx, {
      profileId,
      targetId: target.id,
      finishedAt: now(),
      candidates: [
        { recordUrl: `https://${target.domain}/p/1`, name: "Jordan Example", locations: [] },
      ],
    });
    const match = seedMatch(ctx, {
      scanId: scan.id,
      profileId,
      targetId: target.id,
      recordUrl: `https://${target.domain}/p/1`,
    });
    expect(await statusOf(target.id)).toBe("to_confirm");

    const decided = await ctx.call(API_ROUTES.matchDecide, {
      params: { id: match.id },
      body: { decision: "mine", rights: ["opt_out", "delete"] },
    });
    expect(decided.ok && decided.body.requestId).toBeTruthy();
    expect(await statusOf(target.id)).toBe("yours");
    const row = (await list()).items.find((item) => item.targetId === target.id);
    expect(row?.records[0]?.request).toMatchObject({ status: expect.any(String) });
  });
});

describe("the status of a site", () => {
  it("is not_found when the site showed no results, and unclear when it showed nothing at all", async () => {
    const clean = site();
    const blank = site();
    seedScan(ctx, {
      profileId,
      targetId: clean.id,
      finishedAt: now(),
      candidates: [],
      noResultsShown: true,
    });
    seedScan(ctx, { profileId, targetId: blank.id, finishedAt: now(), candidates: [] });
    expect(await statusOf(clean.id)).toBe("not_found");
    expect(await statusOf(blank.id)).toBe("unclear");
  });

  it("is not_you when every candidate was turned down", async () => {
    const target = site();
    const scan = seedScan(ctx, {
      profileId,
      targetId: target.id,
      finishedAt: now(),
      candidates: [{ recordUrl: "https://records.test/p/9", name: "Other Person", locations: [] }],
    });
    seedMatch(ctx, { scanId: scan.id, profileId, targetId: target.id, decision: "not_mine" });
    expect(await statusOf(target.id)).toBe("not_you");
  });

  it("is failed when the latest scan ended in an error", async () => {
    const target = site();
    seedScan(ctx, {
      profileId,
      targetId: target.id,
      finishedAt: now(),
      error: "The page timed out",
    });
    expect(await statusOf(target.id)).toBe("failed");
  });

  it("follows the removal: yours while it is open, said removed once it is confirmed, removed once a scan no longer finds it", async () => {
    const target = site();
    const scan = seedScan(ctx, {
      profileId,
      targetId: target.id,
      finishedAt: now(),
      candidates: [],
    });
    const request = seedRequest(ctx, {
      profileId,
      targetId: target.id,
      channel: "form",
      status: "awaiting_reply",
    });
    const match = seedMatch(ctx, {
      scanId: scan.id,
      profileId,
      targetId: target.id,
      decision: "mine",
      requestId: request.id,
    });
    expect(await statusOf(target.id)).toBe("yours");

    ctx.services.requests.addEvent(request.id, {
      type: "relisted",
      actor: "system",
      payload: { recordUrl: null, previousStatus: "confirmed" },
    });
    expect(await statusOf(target.id)).toBe("relisted");

    ctx.services.db
      .update(requests)
      .set({ status: "confirmed" })
      .where(eq(requests.id, request.id))
      .run();
    expect(await statusOf(target.id)).toBe("claimed_removed");

    ctx.services.db
      .update(matches)
      .set({ verifiedGoneAt: now() })
      .where(eq(matches.id, match.id))
      .run();
    expect(await statusOf(target.id)).toBe("removed");
  });

  it("filters by status and counts every status regardless of the filter", async () => {
    const a = site();
    const b = site();
    seedScan(ctx, {
      profileId,
      targetId: a.id,
      finishedAt: now(),
      candidates: [],
      noResultsShown: true,
    });
    const result = await list({ status: "not_found" });
    expect(result.items.map((item) => item.targetId)).toEqual([a.id]);
    expect(result.counts.not_found).toBe(1);
    expect(result.counts.not_scanned).toBe(1);
    expect(b.id).toBeTruthy();
    expect(result.lastScanAt).toBe(now());
    expect(result.nextRescanAt).not.toBeNull();
  });

  it("says what the profile lacks before a scan is started", async () => {
    const nameOnly = seedProfile(ctx, {
      identities: [
        {
          kind: "name",
          value: { first: "Jordan", last: "Example" },
          isPrimary: true,
          validFrom: null,
          validTo: null,
        },
      ],
    });
    const target = site();
    const result = await ctx.call(API_ROUTES.listingsGet, {
      params: { id: nameOnly.id, targetId: target.id },
    });
    expect(result.ok && result.body.readiness).toMatchObject({
      state: "needs_details",
      missing: expect.stringContaining("address"),
    });
  });

  it("keeps the last ten scans as history on one site", async () => {
    const target = site();
    for (let index = 0; index < 12; index += 1) {
      seedScan(ctx, { profileId, targetId: target.id, finishedAt: now(), candidates: [] });
      ctx.clock.advance(DAY);
    }
    const result = await ctx.call(API_ROUTES.listingsGet, {
      params: { id: profileId, targetId: target.id },
    });
    expect(result.ok && result.body.history).toHaveLength(10);
  });
});

describe("per-site controls", () => {
  it("pausing cancels a scan that is still waiting and shows the site as paused", async () => {
    const target = site();
    await start({ targetIds: [target.id] });
    const paused = await prefer(target.id, { mode: "paused", pausedUntil: "2026-12-01" });
    expect(paused.ok && paused.body.status).toBe("paused");
    expect(ctx.services.taskQueue.list({ profileId, status: ["queued"] })).toEqual([]);
    const row = ctx.services.db.select().from(scans).where(eq(scans.targetId, target.id)).get();
    expect(row?.error).toBe("Cancelled because you paused this site");

    const resumed = await prefer(target.id, { mode: "auto" });
    expect(resumed.ok && resumed.body.status).toBe("not_scanned");
  });

  it("lets a pause lapse on its date", async () => {
    const target = site();
    await prefer(target.id, { mode: "paused", pausedUntil: "2026-10-09" });
    expect(await statusOf(target.id)).toBe("paused");
    ctx.clock.advance(3 * DAY);
    expect(await statusOf(target.id)).toBe("not_scanned");
  });

  it("leaves paused and skipped sites out of a preset scan and says why", async () => {
    const paused = site();
    const skipped = site();
    const open = site();
    await prefer(paused.id, { mode: "paused" });
    await prefer(skipped.id, { mode: "skipped" });
    const result = await start({ preset: "people_search" });
    if (!result.ok) throw new Error("scan did not start");
    const byId = new Map(result.body.items.map((item) => [item.targetId, item]));
    expect(byId.get(paused.id)).toMatchObject({ outcome: "skipped", reason: "site_paused" });
    expect(byId.get(skipped.id)).toMatchObject({ outcome: "skipped", reason: "site_skipped" });
    expect(byId.get(open.id)?.outcome).toBe("scan_started");
  });

  it("scans a paused site when it is named, but never a skipped one", async () => {
    const paused = site();
    const skipped = site();
    await prefer(paused.id, { mode: "paused" });
    await prefer(skipped.id, { mode: "skipped" });
    const result = await start({ targetIds: [paused.id, skipped.id] });
    if (!result.ok) throw new Error("scan did not start");
    expect(result.body.items[0]).toMatchObject({ targetId: paused.id, outcome: "scan_started" });
    expect(result.body.items[1]).toMatchObject({ reason: "site_skipped" });
  });

  it("stops counting a skipped site among the sites that cannot be scanned", async () => {
    const nameOnly = seedProfile(ctx, {
      identities: [
        {
          kind: "name",
          value: { first: "Jordan", last: "Example" },
          isPrimary: true,
          validFrom: null,
          validTo: null,
        },
      ],
    });
    const target = site();
    const before = await ctx.call(API_ROUTES.dashboardGet, { params: { id: nameOnly.id } });
    expect(before.ok && before.body.scanning.needsDetails).toBe(1);
    await ctx.call(API_ROUTES.listingsPreference, {
      params: { id: nameOnly.id, targetId: target.id },
      body: { mode: "skipped" },
    });
    const after = await ctx.call(API_ROUTES.dashboardGet, { params: { id: nameOnly.id } });
    expect(after.ok && after.body.scanning.needsDetails).toBe(0);
    expect(after.ok && after.body.listings.counts.skipped).toBe(1);
  });

  it("rejects a cadence shorter than a month", async () => {
    const target = site();
    const response = await ctx.inject({
      method: "PUT",
      url: `/api/profiles/${profileId}/listings/${target.id}/preference`,
      payload: { mode: "auto", rescanDays: 7 },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("rescans follow the preferences", () => {
  async function scannedLongAgo(days: number) {
    const target = site();
    seedRecipe(ctx, target.id, { purpose: "scan" });
    seedScan(ctx, { profileId, targetId: target.id, finishedAt: now(), candidates: [] });
    ctx.clock.advance(days * DAY);
    return target;
  }

  it("rescans a site on the global cadence by default", async () => {
    await scannedLongAgo(61);
    expect(enqueueDueRescans(ctx.services)).toBe(1);
  });

  it("uses the cadence chosen for the site", async () => {
    const target = await scannedLongAgo(61);
    await prefer(target.id, { mode: "auto", rescanDays: 180 });
    expect(enqueueDueRescans(ctx.services)).toBe(0);
  });

  it("skips a paused site and resumes it once the pause has passed", async () => {
    const target = await scannedLongAgo(61);
    await prefer(target.id, { mode: "paused", pausedUntil: "2026-12-30" });
    expect(enqueueDueRescans(ctx.services)).toBe(0);
    ctx.clock.advance(100 * DAY);
    expect(enqueueDueRescans(ctx.services)).toBe(1);
  });

  it("rescans a site only when asked if it is set that way, and shows no next date", async () => {
    const target = await scannedLongAgo(400);
    await prefer(target.id, { mode: "auto", autoRescan: false });
    expect(enqueueDueRescans(ctx.services)).toBe(0);
    const row = (await list()).items.find((item) => item.targetId === target.id);
    expect(row?.nextRescanAt).toBeNull();
  });

  it("never rescans a skipped site", async () => {
    const target = await scannedLongAgo(400);
    await prefer(target.id, { mode: "skipped" });
    expect(enqueueDueRescans(ctx.services)).toBe(0);
  });
});

describe("past addresses", () => {
  const withPastAddress = () =>
    seedProfile(ctx, {
      identities: [
        ...jordanIdentities(),
        {
          kind: "address",
          value: { street: "9 Old Road", city: "Dallas", state: "TX", zip: "75001" },
          isPrimary: false,
          validFrom: "2015-01-01",
          validTo: "2020-01-01",
        },
      ],
    });

  it("searches under each past address only when asked, as separate scans", async () => {
    const owner = withPastAddress();
    const target = site();
    const run = (addresses?: "current" | "all") =>
      ctx.call(API_ROUTES.scansStart, {
        params: { id: owner.id },
        body: { targetIds: [target.id], ...(addresses ? { addresses } : {}) },
      });

    await run("current");
    expect(ctx.services.taskQueue.list({ profileId: owner.id })).toHaveLength(1);

    const again = await run("all");
    expect(again.ok && again.body.items[0]?.outcome).toBe("scan_started");
    expect(ctx.services.taskQueue.list({ profileId: owner.id })).toHaveLength(2);
    expect(
      ctx.services.db.select().from(scans).where(eq(scans.profileId, owner.id)).all(),
    ).toHaveLength(2);
  });

  it("includes them for a site that is set to, unless the request says current", async () => {
    const owner = withPastAddress();
    const target = site();
    await ctx.call(API_ROUTES.listingsPreference, {
      params: { id: owner.id, targetId: target.id },
      body: { mode: "auto", includePastAddresses: true },
    });
    await ctx.call(API_ROUTES.scansStart, {
      params: { id: owner.id },
      body: { targetIds: [target.id] },
    });
    expect(ctx.services.taskQueue.list({ profileId: owner.id })).toHaveLength(2);
  });
});

describe("removals that ended badly and scans that need a check", () => {
  it.each(["rejected", "bounced", "no_response", "cancelled"] as const)(
    "sends a %s removal back to the person",
    async (status) => {
      const target = site();
      const scan = seedScan(ctx, {
        profileId,
        targetId: target.id,
        finishedAt: now(),
        candidates: [],
      });
      const request = seedRequest(ctx, { profileId, targetId: target.id, channel: "form", status });
      seedMatch(ctx, {
        scanId: scan.id,
        profileId,
        targetId: target.id,
        decision: "mine",
        requestId: request.id,
      });
      expect(await statusOf(target.id)).toBe("removal_stalled");
    },
  );

  it("asks for the person when a scan is blocked, and withdraws it when the site is paused", async () => {
    const target = site();
    seedRecipe(ctx, target.id, { purpose: "scan" });
    await start({ targetIds: [target.id] });
    const row = ctx.services.db.select().from(scans).where(eq(scans.targetId, target.id)).get();
    ctx.services.db
      .update(tasks)
      .set({ status: "blocked" })
      .where(eq(tasks.id, row?.taskId ?? ""))
      .run();
    expect(await statusOf(target.id)).toBe("needs_check");

    await prefer(target.id, { mode: "skipped" });
    const task = ctx.services.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, row?.taskId ?? ""))
      .get();
    expect(task?.status).toBe("cancelled");
  });
});

describe("changing one setting of a paused site", () => {
  it("keeps the date it is paused until", async () => {
    const target = site();
    await prefer(target.id, { mode: "paused", pausedUntil: "2026-12-01" });
    const changed = await prefer(target.id, { mode: "paused", includePastAddresses: true });
    expect(changed.ok && changed.body.preference).toMatchObject({
      mode: "paused",
      pausedUntil: "2026-12-01",
      includePastAddresses: true,
    });
  });

  it("does not withdraw a scan asked for since the pause", async () => {
    const target = site();
    seedRecipe(ctx, target.id, { purpose: "scan" });
    await prefer(target.id, { mode: "paused", pausedUntil: "2026-12-01" });
    await start({ targetIds: [target.id] });
    await prefer(target.id, { mode: "paused", includePastAddresses: true });
    expect(ctx.services.taskQueue.list({ profileId, status: ["queued"] })).toHaveLength(1);
  });

  it("ends the pause on the date in the scanning time zone", async () => {
    ctx.services.settings.set(
      "scanning",
      ScanningSettings.parse({ timeZone: "America/Los_Angeles" }),
    );
    const target = site();
    await prefer(target.id, { mode: "paused", pausedUntil: "2026-10-08" });
    ctx.clock.advance(15 * 60 * 60 * 1000);
    expect(ctx.clock.now().toISOString().slice(0, 10)).toBe("2026-10-08");
    expect(await statusOf(target.id)).toBe("paused");
    ctx.clock.advance(6 * 60 * 60 * 1000);
    expect(await statusOf(target.id)).toBe("not_scanned");
  });
});

describe("when the next rescan is", () => {
  it("counts from the newest scan that ran, the same for the list and the scheduler", async () => {
    const target = site();
    seedRecipe(ctx, target.id, { purpose: "scan" });
    seedScan(ctx, { profileId, targetId: target.id, finishedAt: now(), candidates: [] });
    ctx.clock.advance(70 * DAY);
    await start({ targetIds: [target.id] });
    await prefer(target.id, { mode: "paused" });
    await prefer(target.id, { mode: "auto" });

    const row = (await list()).items.find((item) => item.targetId === target.id);
    expect(Date.parse(row?.nextRescanAt ?? "")).toBeLessThan(ctx.clock.now().getTime());
    expect(enqueueDueRescans(ctx.services)).toBe(1);
  });

  it("leaves a rescan that is already due out of the next one", async () => {
    const overdue = site();
    seedRecipe(ctx, overdue.id, { purpose: "scan" });
    seedScan(ctx, { profileId, targetId: overdue.id, finishedAt: now(), candidates: [] });
    ctx.clock.advance(70 * DAY);
    const upcoming = site();
    seedRecipe(ctx, upcoming.id, { purpose: "scan" });
    seedScan(ctx, { profileId, targetId: upcoming.id, finishedAt: now(), candidates: [] });

    const summary = await list();
    const next = summary.items.find((item) => item.targetId === upcoming.id)?.nextRescanAt;
    expect(summary.nextRescanAt).toBe(next);
  });
});
