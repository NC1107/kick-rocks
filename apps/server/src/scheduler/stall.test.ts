import { NotificationSettings } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateState } from "../modules/notifications/state.js";
import { createRunners } from "../runners/index.js";
import {
  createTestContext,
  HOUR,
  MINUTE,
  seedMailbox,
  seedMessage,
  seedProfile,
  seedRecipe,
  seedTarget,
  seedTask,
  type TestContext,
} from "../test-utils/index.js";
import { createScheduler, type Scheduler } from "./scheduler.js";

let ctx: TestContext;
let profileId: string;
let scheduler: Scheduler;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  seedMailbox(ctx, profileId);
  scheduler = createScheduler(ctx.services, {
    runners: createRunners(ctx.services, { random: () => 0 }),
    housekeepingMs: 0,
    retentionMs: 0,
  });
});

afterEach(async () => {
  await ctx.close();
  vi.restoreAllMocks();
});

/** A transport whose send never answers until the test lets it, like an SMTP host that went silent. */
function stallSends() {
  let release: () => void = () => {};
  let sends = 0;
  const started = new Promise<void>((resolve) => {
    vi.spyOn(ctx.services.mail, "transport").mockReturnValue({
      verify: () => Promise.resolve({ ok: true, smtp: true, imap: true }) as never,
      send: () =>
        new Promise((resolveSend) => {
          sends += 1;
          release = () =>
            resolveSend({
              messageId: "<m@example.com>",
              accepted: ["x@example.com"],
              rejected: [],
            });
          resolve();
        }),
    });
  });
  return { started, release: () => release(), sends: () => sends };
}

function queueSend() {
  const target = seedTarget(ctx);
  return ctx.services.requests.open({
    profileId,
    targetId: target.id,
    rights: ["opt_out"],
    channel: "email",
    actor: "user",
  }).request;
}

describe("a send that never answers", () => {
  it("does not stop lease reaping or the pass marker while the sender waits", async () => {
    const stalled = stallSends();
    queueSend();
    const stuck = scheduler.tick();
    await stalled.started;

    ctx.services.settings.set("auth.passwordHash", "hash");
    ctx.services.settings.set("siteChecks.enabled", true);
    const target = seedTarget(ctx, { id: "canary-target" });
    const task = seedTask(ctx, {
      kind: "canary",
      payload: { recipeId: seedRecipe(ctx, target.id).id },
      status: "leased",
      attempts: 1,
    });
    ctx.clock.advance(HOUR);
    await scheduler.tick();

    expect(ctx.services.taskQueue.getOrThrow(task.id).status).toBe("queued");
    expect(ctx.services.liveness.scheduler().lastPassAt).not.toBeNull();

    stalled.release();
    await stuck;
    await scheduler.stop();
  });

  it("runs the other jobs on every tick while one send is still in flight", async () => {
    const stalled = stallSends();
    queueSend();
    const stuck = scheduler.tick();
    await stalled.started;

    const reaps = vi.spyOn(ctx.services.taskQueue, "reapExpiredLeases");
    await scheduler.tick();
    await scheduler.tick();
    expect(reaps).toHaveBeenCalledTimes(2);

    stalled.release();
    await stuck;
    await scheduler.stop();
  });
});

describe("a send that outlives its lease", () => {
  it("sends the mail once and finishes its task when the answer comes late", async () => {
    const stalled = stallSends();
    const request = queueSend();
    const stuck = scheduler.tick();
    await stalled.started;
    const [leased] = ctx.services.taskQueue.list({ status: "leased" });

    ctx.clock.advance(6 * MINUTE);
    await scheduler.tick();
    expect(ctx.services.taskQueue.getOrThrow(leased?.id ?? "").status).toBe("queued");

    stalled.release();
    await stuck;

    expect(ctx.services.taskQueue.getOrThrow(leased?.id ?? "").status).toBe("done");
    expect(ctx.services.requests.getOrThrow(request.id).status).toBe("awaiting_reply");

    ctx.clock.advance(HOUR);
    await scheduler.tick();
    await scheduler.tick();
    expect(stalled.sends()).toBe(1);
    await scheduler.stop();
  });
});

describe("a digest that never answers", () => {
  it("does not stop lease reaping or the pass marker", async () => {
    const mailboxId = ctx.services.db.query.mailboxes.findFirst().sync()?.id ?? "";
    ctx.services.settings.set(
      "notifications",
      NotificationSettings.parse({ digest: { frequency: "daily", hourUtc: 0 } }),
    );
    updateState(ctx.services, () => ({ digestLastSentAt: "2000-01-01T00:00:00.000Z" }));
    seedMessage(ctx, { mailboxId });
    ctx.services.settings.set("auth.passwordHash", "hash");
    ctx.services.settings.set("siteChecks.enabled", true);
    const stalled = stallSends();
    const stuck = scheduler.tick();
    await stalled.started;
    expect(stalled.sends()).toBe(1);

    const target = seedTarget(ctx, { id: "canary-target" });
    const task = seedTask(ctx, {
      kind: "canary",
      payload: { recipeId: seedRecipe(ctx, target.id).id },
      status: "leased",
      attempts: 1,
    });
    ctx.clock.advance(HOUR);
    await scheduler.tick();

    expect(ctx.services.taskQueue.getOrThrow(task.id).status).toBe("queued");
    expect(ctx.services.liveness.scheduler().lastPassAt?.getTime()).toBe(ctx.clock.now().getTime());

    stalled.release();
    await stuck;
    await scheduler.stop();
  });
});

describe("the health check while a pass never returns", () => {
  it("reports a sending pass that has outlasted what a send may take", async () => {
    const stalled = stallSends();
    queueSend();
    const stuck = scheduler.tick();
    await stalled.started;
    const health = () => ctx.app.inject({ method: "GET", url: "/api/health" });

    ctx.clock.advance(4 * MINUTE);
    await scheduler.tick();
    expect((await health()).statusCode).toBe(200);

    ctx.clock.advance(3 * MINUTE);
    await scheduler.tick();
    expect(ctx.services.liveness.scheduler().stalled).toBe(false);
    expect((await health()).statusCode).toBe(503);

    stalled.release();
    await stuck;
    expect((await health()).statusCode).toBe(200);
    await scheduler.stop();
  });
});

describe("stopping while a send never answers", () => {
  it("gives up after the grace period and hands the send back to the queue", async () => {
    const stalled = stallSends();
    const request = queueSend();
    void scheduler.tick();
    await stalled.started;
    const leased = ctx.services.taskQueue.list({ status: "leased" });
    expect(leased).toHaveLength(1);

    const startedAt = Date.now();
    await scheduler.stop({ graceMs: 50 });
    expect(Date.now() - startedAt).toBeLessThan(2_000);

    expect(ctx.services.taskQueue.getOrThrow(leased[0]?.id ?? "")).toMatchObject({
      status: "queued",
      leaseOwner: null,
      attempts: 0,
    });
    expect(ctx.services.requests.getOrThrow(request.id).status).toBe("queued");
    stalled.release();
  });

  it("waits for a send that finishes inside the grace period", async () => {
    const stalled = stallSends();
    const request = queueSend();
    void scheduler.tick();
    await stalled.started;

    const stopped = scheduler.stop({ graceMs: 5_000 });
    stalled.release();
    await stopped;

    expect(ctx.services.requests.getOrThrow(request.id).status).toBe("awaiting_reply");
  });
});
