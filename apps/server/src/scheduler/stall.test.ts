import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRunners } from "../runners/index.js";
import {
  createTestContext,
  HOUR,
  seedMailbox,
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
  const started = new Promise<void>((resolve) => {
    vi.spyOn(ctx.services.mail, "transport").mockReturnValue({
      verify: () => Promise.resolve({ ok: true, smtp: true, imap: true }) as never,
      send: () =>
        new Promise((resolveSend) => {
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
  return { started, release: () => release() };
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
