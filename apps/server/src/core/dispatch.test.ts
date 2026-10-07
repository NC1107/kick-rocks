import { scans, tasks } from "@kickrocks/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";

let ctx: TestContext;
let profileId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
});

afterEach(async () => {
  await ctx.close();
});

const queuedRequest = (
  targetId: string,
  overrides: Partial<Parameters<typeof seedRequest>[1]> = {},
) => seedRequest(ctx, { profileId, targetId, status: "queued", ...overrides });

describe("dispatchRequest for email", () => {
  it("queues an email_send task and records a task_enqueued event", () => {
    const target = seedTarget(ctx);
    const request = queuedRequest(target.id);
    const { task, created } = ctx.services.dispatch.dispatchRequest(request);
    expect(created).toBe(true);
    expect(task).toMatchObject({
      kind: "email_send",
      status: "queued",
      payload: { requestId: request.id, followUp: false },
      profileId,
      targetId: target.id,
      requestId: request.id,
      dedupeKey: `email_send:${request.id}`,
    });
    const events = ctx.services.requests.events(request.id);
    expect(events.at(-1)).toMatchObject({
      type: "task_enqueued",
      actor: "system",
      payload: { taskId: task.id, kind: "email_send" },
    });
  });

  it("does not queue the same request twice while a task is live", () => {
    const request = queuedRequest(seedTarget(ctx).id);
    const first = ctx.services.dispatch.dispatchRequest(request);
    const second = ctx.services.dispatch.dispatchRequest(request);
    expect(second.created).toBe(false);
    expect(second.task.id).toBe(first.task.id);
    expect(
      ctx.services.requests.events(request.id).filter((e) => e.type === "task_enqueued"),
    ).toHaveLength(1);
  });

  it("marks a request that was already sent as a follow-up", () => {
    const request = queuedRequest(seedTarget(ctx).id, { sentAt: ctx.clock.now().toISOString() });
    expect(ctx.services.dispatch.dispatchRequest(request).task.payload).toMatchObject({
      followUp: true,
    });
  });

  it("refuses a request that is not queued", () => {
    const request = seedRequest(ctx, { profileId, targetId: seedTarget(ctx).id, status: "draft" });
    expect(() => ctx.services.dispatch.dispatchRequest(request)).toThrow(
      /Only a queued request can be dispatched/,
    );
    expect(ctx.services.taskQueue.list()).toEqual([]);
  });
});

describe("dispatchRequest for forms", () => {
  const formRequest = (
    targetId: string,
    overrides: Partial<Parameters<typeof seedRequest>[1]> = {},
  ) => queuedRequest(targetId, { channel: "form", ...overrides });

  it("queues a form task with the active remove recipe", () => {
    const target = seedTarget(ctx, { contactMethod: "form" });
    const recipe = seedRecipe(ctx, target.id, { purpose: "remove", version: 1 });
    const request = formRequest(target.id, { recordUrl: "https://x.test/p/1" });
    const { task } = ctx.services.dispatch.dispatchRequest(request);
    expect(task).toMatchObject({
      kind: "form",
      payload: {
        requestId: request.id,
        targetId: target.id,
        recipeId: recipe.id,
        recordUrl: "https://x.test/p/1",
      },
      dedupeKey: `form:${request.id}`,
    });
  });

  it("prefers the newest active version", () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { version: 1 });
    const newest = seedRecipe(ctx, target.id, { version: 3 });
    seedRecipe(ctx, target.id, { version: 2 });
    const { task } = ctx.services.dispatch.dispatchRequest(formRequest(target.id));
    expect(task.payload).toMatchObject({ recipeId: newest.id });
  });

  it.each(["pending_review", "rejected", "retired"] as const)(
    "ignores a %s recipe and falls back to an agent",
    (status) => {
      const target = seedTarget(ctx);
      seedRecipe(ctx, target.id, { status });
      const request = formRequest(target.id);
      const { task } = ctx.services.dispatch.dispatchRequest(request);
      expect(task).toMatchObject({
        kind: "agent",
        payload: {
          purpose: "remove",
          profileId,
          targetId: target.id,
          requestId: request.id,
          recordUrl: null,
          reason: "no_recipe",
          previousError: null,
        },
      });
    },
  );

  it("ignores a scan recipe when removing", () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { purpose: "scan" });
    expect(ctx.services.dispatch.dispatchRequest(formRequest(target.id)).task.kind).toBe("agent");
  });

  it("still uses a recipe whose health is broken, leaving conversion to the failure handler", () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { health: "broken" });
    expect(ctx.services.dispatch.dispatchRequest(formRequest(target.id)).task.kind).toBe("form");
  });

  it("requires a record url for a target that removes a specific record", () => {
    const target = seedTarget(ctx, { category: "people-search", requirements: ["record_url"] });
    expect(() => ctx.services.dispatch.dispatchRequest(formRequest(target.id))).toThrow(
      /needs a record URL/,
    );
    expect(
      ctx.services.dispatch.dispatchRequest(
        formRequest(target.id, { recordUrl: "https://x.test/p/1" }),
      ).created,
    ).toBe(true);
  });

  it("does not queue a second task for the same form request", () => {
    const target = seedTarget(ctx);
    const request = formRequest(target.id);
    ctx.services.dispatch.dispatchRequest(request);
    expect(ctx.services.dispatch.dispatchRequest(request).created).toBe(false);
  });
});

describe("enqueueScan", () => {
  it("queues a scan task with the active scan recipe and a scans row", () => {
    const target = seedTarget(ctx, { category: "people-search", requirements: ["record_url"] });
    const recipe = seedRecipe(ctx, target.id, { purpose: "scan" });
    const result = ctx.services.dispatch.enqueueScan(profileId, target.id);
    expect(result.created).toBe(true);
    expect(result.task).toMatchObject({
      kind: "scan",
      payload: { profileId, targetId: target.id, recipeId: recipe.id },
      profileId,
      targetId: target.id,
      dedupeKey: `scan:${profileId}:${target.id}`,
    });
    const row = ctx.services.db
      .select()
      .from(scans)
      .where(eq(scans.id, result.scanId ?? ""))
      .get();
    expect(row).toMatchObject({
      profileId,
      targetId: target.id,
      taskId: result.task.id,
      startedAt: ctx.clock.now().toISOString(),
      finishedAt: null,
      candidates: null,
      error: null,
    });
  });

  it("falls back to an agent scan task without a recipe", () => {
    const target = seedTarget(ctx);
    const { task } = ctx.services.dispatch.enqueueScan(profileId, target.id);
    expect(task).toMatchObject({
      kind: "agent",
      payload: {
        purpose: "scan",
        profileId,
        targetId: target.id,
        requestId: null,
        recordUrl: null,
        reason: "no_recipe",
        previousError: null,
      },
    });
  });

  it("ignores a remove recipe when scanning", () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { purpose: "remove" });
    expect(ctx.services.dispatch.enqueueScan(profileId, target.id).task.kind).toBe("agent");
  });

  it("returns the live scan instead of starting another", () => {
    const target = seedTarget(ctx);
    const first = ctx.services.dispatch.enqueueScan(profileId, target.id);
    const second = ctx.services.dispatch.enqueueScan(profileId, target.id);
    expect(second).toMatchObject({ created: false, scanId: first.scanId });
    expect(second.task.id).toBe(first.task.id);
    expect(ctx.services.db.select().from(scans).all()).toHaveLength(1);
  });

  it("starts a fresh scan once the earlier one finished", async () => {
    const target = seedTarget(ctx);
    const first = ctx.services.dispatch.enqueueScan(profileId, target.id);
    ctx.services.taskQueue.claim({ workerId: "w", kinds: ["agent"], leaseMs: 60_000 });
    await ctx.services.taskQueue.complete(first.task.id, {
      workerId: "w",
      result: { purpose: "scan", scan: { candidates: [] } },
      actor: "agent",
    });
    const second = ctx.services.dispatch.enqueueScan(profileId, target.id);
    expect(second.created).toBe(true);
    expect(second.scanId).not.toBe(first.scanId);
  });

  it("scans different profiles and targets independently", () => {
    const other = seedProfile(ctx);
    const a = seedTarget(ctx);
    const b = seedTarget(ctx);
    const results = [
      ctx.services.dispatch.enqueueScan(profileId, a.id),
      ctx.services.dispatch.enqueueScan(profileId, b.id),
      ctx.services.dispatch.enqueueScan(other.id, a.id),
    ];
    expect(results.every((r) => r.created)).toBe(true);
  });

  it("rejects an unknown target without leaving anything behind", () => {
    expect(() => ctx.services.dispatch.enqueueScan(profileId, "missing")).toThrow(/not found/);
    expect(ctx.services.db.select().from(tasks).all()).toEqual([]);
  });

  it("rolls the task back when the scans row cannot be written", () => {
    const target = seedTarget(ctx);
    expect(() => ctx.services.dispatch.enqueueScan("no-such-profile", target.id)).toThrow();
    expect(ctx.services.db.select().from(tasks).all()).toEqual([]);
  });
});

describe("needsRecord", () => {
  it("is the shared rule for people-search and background-check sites", () => {
    const { needsRecord } = ctx.services.dispatch;
    expect(needsRecord({ category: "people-search", requirements: ["record_url"] })).toBe(true);
    expect(needsRecord({ category: "background-check", requirements: ["record_url"] })).toBe(true);
    expect(needsRecord({ category: "marketing", requirements: ["record_url"] })).toBe(false);
    expect(needsRecord({ category: "people-search", requirements: [] })).toBe(false);
  });
});
