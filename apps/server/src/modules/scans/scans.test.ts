import { targets } from "@kickrocks/db";
import { API_ROUTES, type RouteBodyInput } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  HOUR,
  seedMatch,
  seedProfile,
  seedRecipe,
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

const peopleSearch = (overrides: Parameters<typeof seedTarget>[1] = {}) =>
  seedTarget(ctx, { category: "people-search", contactMethod: "form", ...overrides });

const start = (body: RouteBodyInput<typeof API_ROUTES.scansStart>, id = profileId) =>
  ctx.call(API_ROUTES.scansStart, { params: { id }, body });

describe("POST /profiles/:id/scans", () => {
  it("starts a scan for each target and answers 201", async () => {
    const first = peopleSearch();
    const second = peopleSearch();
    seedRecipe(ctx, first.id, { purpose: "scan" });

    const result = await start({ targetIds: [first.id, second.id] });

    expect(result).toMatchObject({ ok: true, status: 201 });
    if (!result.ok) return;
    expect(result.body.items).toEqual([
      expect.objectContaining({
        targetId: first.id,
        targetName: first.name,
        outcome: "scan_started",
        reason: null,
        requestId: null,
      }),
      expect.objectContaining({ targetId: second.id, outcome: "scan_started" }),
    ]);
    const tasks = ctx.services.taskQueue.list({ profileId });
    expect(tasks.map((task) => task.kind).sort()).toEqual(["agent", "scan"]);
    expect(result.body.items[0]?.scanId).toBeTruthy();
  });

  it("scans every people-search target for the preset and nothing else", async () => {
    const found = peopleSearch();
    const background = seedTarget(ctx, { category: "background-check" });
    seedTarget(ctx, { category: "marketing" });
    seedTarget(ctx, { kind: "company" });
    const retired = peopleSearch();
    ctx.services.db.update(targets).set({ retired: true }).where(eq(targets.id, retired.id)).run();

    const result = await start({ preset: "people_search" });

    expect(result.ok && result.body.items.map((item) => item.targetId).sort()).toEqual(
      [found.id, background.id].sort(),
    );
  });

  it("skips a scan that is already running and points at it", async () => {
    const target = peopleSearch();
    const first = await start({ targetIds: [target.id] });
    const second = await start({ targetIds: [target.id] });
    if (!first.ok || !second.ok) throw new Error("scan did not start");
    expect(second.body.items[0]).toMatchObject({
      outcome: "skipped",
      reason: "scan_in_progress",
      scanId: first.body.items[0]?.scanId,
    });
    expect(ctx.services.taskQueue.list({ profileId })).toHaveLength(1);
  });

  it("starts another scan once the last one is done", async () => {
    const target = peopleSearch();
    const first = await start({ targetIds: [target.id] });
    const [task] = ctx.services.taskQueue.list({ profileId });
    ctx.services.taskQueue.cancel(task?.id ?? "");
    const second = await start({ targetIds: [target.id] });
    expect(first.ok && second.ok && second.body.items[0]?.outcome).toBe("scan_started");
  });

  it("skips a target that does not list people, with a sentence saying why", async () => {
    const marketing = seedTarget(ctx, { category: "marketing" });
    const result = await start({ targetIds: [marketing.id] });
    expect(result.ok && result.body.items[0]).toMatchObject({
      outcome: "skipped",
      reason: "unsupported_channel",
      detail: expect.stringContaining("nothing to scan"),
    });
    expect(ctx.services.taskQueue.list({ profileId })).toHaveLength(0);
  });

  it("skips a target that left the dataset", async () => {
    const retired = peopleSearch();
    ctx.services.db.update(targets).set({ retired: true }).where(eq(targets.id, retired.id)).run();
    const result = await start({ targetIds: [retired.id] });
    expect(result.ok && result.body.items[0]).toMatchObject({
      outcome: "skipped",
      detail: expect.stringContaining("no longer in the dataset"),
    });
  });

  it("answers 404 for an unknown target and starts none of the others", async () => {
    const target = peopleSearch();
    const result = await start({ targetIds: [target.id, "nope"] });
    expect(result).toMatchObject({ ok: false, status: 404, body: { error: "target_not_found" } });
    expect(ctx.services.taskQueue.list({ profileId })).toHaveLength(0);
  });

  it("answers 404 for an unknown profile", async () => {
    const result = await start({ preset: "people_search" }, "nobody");
    expect(result).toMatchObject({ ok: false, status: 404, body: { error: "profile_not_found" } });
  });

  it("rejects a body that names neither targets nor a preset", async () => {
    const response = await ctx.inject({
      method: "POST",
      url: `/api/profiles/${profileId}/scans`,
      payload: { targetIds: [] },
    });
    expect(response.statusCode).toBe(400);
  });

  it("needs a session", async () => {
    ctx.auth.deny();
    const response = await ctx.inject({
      method: "POST",
      url: `/api/profiles/${profileId}/scans`,
      payload: { preset: "people_search" },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("GET /profiles/:id/scans", () => {
  it("lists scans newest first with the state of their task and the decisions on their matches", async () => {
    const target = peopleSearch();
    const older = seedScan(ctx, {
      profileId,
      targetId: target.id,
      finishedAt: ctx.clock.now().toISOString(),
      candidates: [
        { recordUrl: "https://records.test/p/1", name: "Jordan Example", locations: [] },
        { recordUrl: "https://records.test/p/2", name: "Jordan Example", locations: [] },
        { recordUrl: "https://records.test/p/3", name: "Jordan Example", locations: [] },
      ],
    });
    seedMatch(ctx, { scanId: older.id, profileId, targetId: target.id, decision: "pending" });
    seedMatch(ctx, { scanId: older.id, profileId, targetId: target.id, decision: "mine" });
    seedMatch(ctx, { scanId: older.id, profileId, targetId: target.id, decision: "not_mine" });
    ctx.clock.advance(HOUR);
    const started = await start({ targetIds: [target.id] });
    if (!started.ok) throw new Error("scan did not start");

    const result = await ctx.call(API_ROUTES.scansList, { params: { id: profileId } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({ total: 2, page: 1, pageSize: 50 });
    expect(result.body.items[0]).toMatchObject({
      id: started.body.items[0]?.scanId,
      targetName: target.name,
      taskStatus: "queued",
      finishedAt: null,
      candidateCount: 0,
      matchCounts: { pending: 0, mine: 0, not_mine: 0 },
      error: null,
    });
    expect(result.body.items[1]).toMatchObject({
      id: older.id,
      taskId: null,
      taskStatus: null,
      candidateCount: 3,
      matchCounts: { pending: 1, mine: 1, not_mine: 1 },
    });
  });

  it("pages the list", async () => {
    const target = peopleSearch();
    for (let index = 0; index < 5; index += 1) {
      seedScan(ctx, { profileId, targetId: target.id });
      ctx.clock.advance(HOUR);
    }
    const second = await ctx.call(API_ROUTES.scansList, {
      params: { id: profileId },
      query: { page: 2, pageSize: 2 },
    });
    expect(second.ok && second.body).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(second.ok && second.body.items).toHaveLength(2);
    const last = await ctx.call(API_ROUTES.scansList, {
      params: { id: profileId },
      query: { page: 3, pageSize: 2 },
    });
    expect(last.ok && last.body.items).toHaveLength(1);
  });

  it("lists only this profile's scans", async () => {
    const target = peopleSearch();
    const other = seedProfile(ctx, { displayName: "Casey Example" });
    seedScan(ctx, { profileId: other.id, targetId: target.id });
    const result = await ctx.call(API_ROUTES.scansList, { params: { id: profileId } });
    expect(result.ok && result.body.total).toBe(0);
  });

  it("answers 404 for an unknown profile", async () => {
    const result = await ctx.call(API_ROUTES.scansList, { params: { id: "nobody" } });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("carries the reason a scan failed", async () => {
    const target = peopleSearch();
    seedScan(ctx, {
      profileId,
      targetId: target.id,
      finishedAt: ctx.clock.now().toISOString(),
      error: "The search page did not load",
    });
    const result = await ctx.call(API_ROUTES.scansList, { params: { id: profileId } });
    expect(result.ok && result.body.items[0]?.error).toBe("The search page did not load");
  });
});
