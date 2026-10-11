import { matches, needsYouMarks, profiles, requestEvents, tasks } from "@kickrocks/db";
import { API_ROUTES, type BlockedReason, type NeedsYouQueue } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  DAY,
  seedMailbox,
  seedMatch,
  seedMessage,
  seedProfile,
  seedRequest,
  seedScan,
  seedTarget,
  seedTask,
  type TestContext,
} from "../../test-utils/index.js";

let ctx: TestContext;
let profileId: string;
let mailboxId: string;
let targetId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  mailboxId = seedMailbox(ctx, profileId).id;
  targetId = seedTarget(ctx, {
    domain: "records.test",
    category: "people-search",
    contactMethod: "form",
    optOutUrl: "https://records.test/optout",
  }).id;
});

afterEach(async () => {
  await ctx.close();
});

const HOUR = 60 * 60 * 1000;

const agentPayload = (requestId: string | null, blockedReason: BlockedReason | null = null) => ({
  purpose: "remove" as const,
  profileId,
  targetId,
  requestId,
  recordUrl: "https://records.test/p/1",
  variant: null,
  rights: ["opt_out" as const],
  reason: "blocked" as const,
  previousError: null,
  blockedReason,
});

function blocked(blockedReason: BlockedReason, forProfile = profileId) {
  const request = seedRequest(ctx, { profileId: forProfile, targetId, channel: "form" });
  return seedTask(ctx, {
    kind: "form",
    status: "blocked",
    payload: {
      requestId: request.id,
      targetId,
      recipeId: null,
      recordUrl: "https://records.test/p/1",
    },
    profileId: forProfile,
    targetId,
    requestId: request.id,
    blockedReason,
  });
}

function yours() {
  return seedTask(ctx, {
    kind: "agent",
    payload: agentPayload(null),
    profileId,
    targetId,
    assignment: {
      to: { kind: "person" },
      at: ctx.services.clock.now().toISOString(),
      by: "user",
      fallback: "any",
    },
  });
}

function heldNow() {
  const request = seedRequest(ctx, { profileId, targetId, channel: "form" });
  const task = seedTask(ctx, {
    kind: "agent",
    status: "leased",
    payload: agentPayload(request.id),
    profileId,
    targetId,
    requestId: request.id,
  });
  ctx.services.taskSends.register(
    task.id,
    "seed-worker",
    1,
    [
      {
        kind: "held",
        holdMs: 5 * 60 * 1000,
        request: {
          method: "POST",
          scheme: "https",
          host: "records.test",
          path: "/optout",
          resourceType: "Document",
          isDocument: true,
          target: { type: "page", frameOrigin: "https://records.test", topLevel: true },
          party: "target",
          bodyKind: "form",
          query: [],
          body: [{ path: "kind", value: "delete", class: "literal" }],
          headers: [],
          bodyBytes: 10,
          bodyDigest: "a".repeat(64),
          carries: [],
        },
      },
    ],
    10 * 60 * 1000,
  );
  return task;
}

const get = async (forProfile?: string): Promise<NeedsYouQueue> => {
  const result = await ctx.call(API_ROUTES.needsYouGet, {
    ...(forProfile ? { query: { profileId: forProfile } } : {}),
  });
  if (!result.ok) throw new Error(`needs-you answered ${result.status}`);
  return result.body;
};

const keys = async () => (await get(profileId)).items.map((item) => item.key);

describe("GET /needs-you", () => {
  it("lists only this profile's items", async () => {
    const other = seedProfile(ctx, { displayName: "Sam Example" });
    const mine = blocked("captcha");
    blocked("captcha", other.id);
    expect(await keys()).toEqual([`task:${mine.id}`]);
  });

  it("holds only what waits on the person", async () => {
    const mine = blocked("captcha");
    const ownTask = yours();
    const scan = seedScan(ctx, { profileId, targetId });
    const match = seedMatch(ctx, { scanId: scan.id, profileId, targetId });
    const request = seedRequest(ctx, { profileId, targetId, status: "needs_verification" });
    seedMessage(ctx, {
      mailboxId,
      requestId: request.id,
      classification: "verification_required",
      requestedFields: ["date_of_birth"],
      reviewed: true,
    });
    // None of these belong in the focused queue.
    seedMessage(ctx, { mailboxId, reviewed: false });
    seedTask(ctx, {
      kind: "form",
      status: "failed",
      payload: {
        requestId: seedRequest(ctx, { profileId, targetId, channel: "form" }).id,
        targetId,
        recipeId: null,
        recordUrl: null,
      },
      profileId,
      targetId,
    });
    seedTask(ctx, { kind: "agent", payload: agentPayload(null), profileId, targetId });

    const { items, counts } = await get(profileId);

    expect(items.map((item) => item.key).sort()).toEqual(
      [
        `task:${mine.id}`,
        `task:${ownTask.id}`,
        `match:${match.id}`,
        `details:${request.id}`,
      ].sort(),
    );
    expect(counts.active).toBe(4);
  });

  it("maps every blocked reason to its kind with an effort", async () => {
    const expected: Record<BlockedReason, string> = {
      captcha: "captcha",
      phone_verification: "phone_code",
      id_upload: "id",
      email_verification: "email_link",
      login_required: "login",
      bot_detection: "bot",
      approval_needed: "approve",
      unapproved_submit: "check_sent",
      unknown: "by_hand",
    };
    for (const reason of Object.keys(expected) as BlockedReason[]) blocked(reason);
    const { items } = await get(profileId);
    for (const item of items) {
      const reason = (item.source as { task: { task: { blockedReason: BlockedReason } } }).task.task
        .blockedReason;
      expect(item.kind).toBe(expected[reason]);
      expect(item.effort.minutes).toBeGreaterThan(0);
      expect(item.chips.length > 0).toBe(
        ["captcha", "phone_code", "id", "email_link", "login", "bot", "by_hand"].includes(
          item.kind,
        ),
      );
    }
  });

  it("puts a live hold first, then the quick items before the slow ones", async () => {
    const slow = blocked("login_required");
    const few = blocked("captcha");
    const scan = seedScan(ctx, { profileId, targetId });
    const match = seedMatch(ctx, { scanId: scan.id, profileId, targetId });
    const hold = heldNow();

    const { items } = await get(profileId);

    expect(items.map((item) => item.key)).toEqual([
      `task:${hold.id}`,
      `match:${match.id}`,
      `task:${few.id}`,
      `task:${slow.id}`,
    ]);
    expect(items.map((item) => item.order)).toEqual([0, 1, 2, 3]);
    expect(items[0]).toMatchObject({ kind: "hold", effort: { band: "quick" } });
    expect(items[0]?.expiresAt).not.toBeNull();
  });
});

describe("snooze", () => {
  const snooze = (key: string, until: Date) => {
    const [kind, id] = key.split(":") as ["task" | "match" | "details", string];
    return ctx.call(API_ROUTES.needsYouSnooze, {
      params: { kind, id },
      body: { until: until.toISOString() },
    });
  };

  it("hides an item until the clock passes the time, and counts it", async () => {
    const task = blocked("captcha");
    const until = new Date(ctx.services.clock.now().getTime() + HOUR);
    expect((await snooze(`task:${task.id}`, until)).ok).toBe(true);

    const hidden = await get(profileId);
    expect(hidden.items).toEqual([]);
    expect(hidden.snoozed).toMatchObject([{ key: `task:${task.id}`, kind: "captcha" }]);
    expect(hidden.counts).toMatchObject({ active: 0, snoozed: 1 });

    ctx.clock.advance(HOUR + 1000);
    const back = await get(profileId);
    expect(back.items.map((item) => item.key)).toEqual([`task:${task.id}`]);
    expect(back.counts.snoozed).toBe(0);
  });

  it("brings an item back when it is unsnoozed", async () => {
    const task = blocked("captcha");
    await snooze(`task:${task.id}`, new Date(ctx.services.clock.now().getTime() + HOUR));
    const result = await ctx.call(API_ROUTES.needsYouUnsnooze, {
      params: { kind: "task", id: task.id },
    });
    expect(result.ok).toBe(true);
    expect(await keys()).toEqual([`task:${task.id}`]);
  });

  it("is ignored once the task changed after the snooze, such as blocked again", async () => {
    const task = blocked("captcha");
    await snooze(`task:${task.id}`, new Date(ctx.services.clock.now().getTime() + 2 * HOUR));
    expect(await keys()).toEqual([]);

    ctx.clock.advance(HOUR / 2);
    ctx.services.db
      .update(tasks)
      .set({
        status: "blocked",
        blockedReason: "login_required",
        updatedAt: ctx.services.clock.now().toISOString(),
      })
      .where(eq(tasks.id, task.id))
      .run();

    expect(await keys()).toEqual([`task:${task.id}`]);
  });

  it("refuses to snooze a hold", async () => {
    const hold = heldNow();
    const result = await snooze(
      `task:${hold.id}`,
      new Date(ctx.services.clock.now().getTime() + HOUR),
    );
    expect(result.status).toBe(409);
    expect(result.ok ? null : result.body.error).toBe("not_snoozable");
  });

  it("refuses a time in the past or more than 30 days away", async () => {
    const task = blocked("captcha");
    const now = ctx.services.clock.now().getTime();
    expect((await snooze(`task:${task.id}`, new Date(now - HOUR))).status).toBe(400);
    expect((await snooze(`task:${task.id}`, new Date(now + 31 * DAY))).status).toBe(400);
    expect((await snooze(`task:${task.id}`, new Date(now + 29 * DAY))).ok).toBe(true);
  });

  it("answers 404 for an unknown item and 409 for one that is resolved", async () => {
    expect((await snooze("task:nope", new Date(Date.now() + HOUR))).status).toBe(404);
    const task = blocked("captcha");
    ctx.services.taskQueue.markDone(task.id, { actor: "user", result: undefined, note: undefined });
    const gone = await snooze(
      `task:${task.id}`,
      new Date(ctx.services.clock.now().getTime() + HOUR),
    );
    expect(gone.status).toBe(409);
  });
});

describe("not yet", () => {
  const notYet = (kind: "task" | "match" | "details", id: string, note?: string) =>
    ctx.call(API_ROUTES.needsYouNotYet, {
      params: { kind, id },
      body: note ? { note } : {},
    });

  it("counts the try, moves the item behind untried ones, and writes the timeline event", async () => {
    const first = blocked("captcha");
    ctx.clock.advance(1000);
    const second = blocked("captcha");

    expect(await keys()).toEqual([`task:${first.id}`, `task:${second.id}`]);

    const result = await notYet("task", first.id, "Page was down");
    expect(result.ok && result.body).toMatchObject({ tries: 1, openedAt: null });

    const { items } = await get(profileId);
    expect(items.map((item) => item.key)).toEqual([`task:${second.id}`, `task:${first.id}`]);
    expect(items[1]).toMatchObject({ tries: 1, lastTriedAt: expect.any(String) });

    const events = ctx.services.db
      .select()
      .from(requestEvents)
      .where(eq(requestEvents.requestId, first.requestId as string))
      .all();
    expect(events.find((event) => event.type === "user_action")?.payload).toEqual({
      action: "not_yet",
      note: "Page was down",
    });
  });

  it("clears the opened time", async () => {
    const task = blocked("captcha");
    await ctx.call(API_ROUTES.needsYouOpened, { params: { kind: "task", id: task.id } });
    expect((await get(profileId)).items[0]?.openedAt).not.toBeNull();
    await notYet("task", task.id);
    expect((await get(profileId)).items[0]?.openedAt).toBeNull();
  });

  it("answers 404 for an unknown item and 409 for a resolved one", async () => {
    expect((await notYet("match", "nope")).status).toBe(404);
    const task = blocked("captcha");
    ctx.services.taskQueue.markDone(task.id, { actor: "user", result: undefined, note: undefined });
    expect((await notYet("task", task.id)).status).toBe(409);
  });
});

describe("opened", () => {
  it("is remembered with the item, and cleared when the task is marked done", async () => {
    const task = blocked("captcha");
    const result = await ctx.call(API_ROUTES.needsYouOpened, {
      params: { kind: "task", id: task.id },
    });
    expect(result.ok && result.body.openedAt).toEqual(ctx.services.clock.now().toISOString());
    expect((await get(profileId)).items[0]?.openedAt).toEqual(
      ctx.services.clock.now().toISOString(),
    );

    const done = await ctx.call(API_ROUTES.taskMarkDone, { params: { id: task.id }, body: {} });
    expect(done.ok).toBe(true);
    const row = ctx.services.db
      .select()
      .from(needsYouMarks)
      .where(eq(needsYouMarks.taskId, task.id))
      .get();
    expect(row?.openedAt).toBeNull();
  });
});

describe("marks", () => {
  it("leave with the task, the match or the profile they are about", async () => {
    const task = blocked("captcha");
    const scan = seedScan(ctx, { profileId, targetId });
    const match = seedMatch(ctx, { scanId: scan.id, profileId, targetId });
    await ctx.call(API_ROUTES.needsYouOpened, { params: { kind: "task", id: task.id } });
    await ctx.call(API_ROUTES.needsYouOpened, { params: { kind: "match", id: match.id } });
    expect(ctx.services.db.select().from(needsYouMarks).all()).toHaveLength(2);

    ctx.services.db.delete(matches).where(eq(matches.id, match.id)).run();
    expect(ctx.services.db.select().from(needsYouMarks).all()).toHaveLength(1);

    ctx.services.db.delete(profiles).where(eq(profiles.id, profileId)).run();
    expect(ctx.services.db.select().from(needsYouMarks).all()).toHaveLength(0);
  });
});

describe("dashboard", () => {
  it("shows the same counts as the queue", async () => {
    blocked("captcha");
    blocked("login_required");
    const scan = seedScan(ctx, { profileId, targetId });
    seedMatch(ctx, { scanId: scan.id, profileId, targetId });
    const queue = await get(profileId);

    const dashboard = await ctx.call(API_ROUTES.dashboardGet, { params: { id: profileId } });
    if (!dashboard.ok) throw new Error("dashboard failed");

    expect(dashboard.body.attention.needsYou).toEqual(queue.counts);
    expect(queue.counts).toEqual({
      active: 3,
      snoozed: 0,
      minutes: 8,
      quick: 1,
      few: 1,
      longer: 1,
    });
  });
});
