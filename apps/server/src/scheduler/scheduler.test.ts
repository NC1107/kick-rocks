import { mailboxes, requests, targets } from "@kickrocks/db";
import type { Broker } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRunners, runnersOf } from "../runners/index.js";
import {
  createTestContext,
  DAY,
  HOUR,
  MINUTE,
  seedMailbox,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedScan,
  seedTarget,
  seedTask,
  type TestContext,
} from "../test-utils/index.js";
import { advanceOverdueRequests } from "./overdue.js";
import { createScheduler, type Scheduler } from "./scheduler.js";

let ctx: TestContext;
let profileId: string;
let mailboxId: string;
let scheduler: Scheduler;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  mailboxId = seedMailbox(ctx, profileId).id;
  scheduler = createScheduler(ctx.services, {
    runners: createRunners(ctx.services, { random: () => 0 }),
    housekeepingMs: 0,
    retentionMs: 0,
  });
});

afterEach(async () => {
  await scheduler.stop();
  await ctx.close();
  vi.restoreAllMocks();
});

const setSchedule = (patch: Record<string, number>) =>
  ctx.services.settings.set("schedule", { ...ctx.services.settings.get("schedule"), ...patch });

const requestOf = (id: string) => ctx.services.requests.getOrThrow(id);
const sentTo = (id: string) =>
  ctx.mail.sent.filter((entry) => entry.mail.subject.includes(requestOf(id).reference));

/** Opens an email request and lets the scheduler send it. */
async function sendRequest(targetOverrides: Parameters<typeof seedTarget>[1] = {}) {
  const target = seedTarget(ctx, targetOverrides);
  const { request } = ctx.services.requests.open({
    profileId,
    targetId: target.id,
    rights: ["opt_out"],
    channel: "email",
    actor: "user",
  });
  await scheduler.tick();
  return { target, request: requestOf(request.id) };
}

describe("an unanswered email request over time", () => {
  it("is followed up twice, then left alone, then sent again from scratch", async () => {
    const { request } = await sendRequest();
    const sentAt = ctx.clock.now().getTime();
    expect(request.status).toBe("awaiting_reply");

    ctx.clock.set(new Date(sentAt + 44 * DAY));
    await scheduler.tick();
    expect(requestOf(request.id).status).toBe("awaiting_reply");

    ctx.clock.set(new Date(sentAt + 45 * DAY));
    await scheduler.tick();
    expect(requestOf(request.id)).toMatchObject({ status: "awaiting_reply", followUps: 1 });
    expect(sentTo(request.id)).toHaveLength(2);
    expect(sentTo(request.id)[1]?.mail.subject).toContain("Follow-up");

    ctx.clock.set(new Date(sentAt + 90 * DAY));
    await scheduler.tick();
    expect(requestOf(request.id)).toMatchObject({ status: "awaiting_reply", followUps: 2 });

    ctx.clock.set(new Date(sentAt + 135 * DAY));
    await scheduler.tick();
    const resent = requestOf(request.id);
    expect(resent).toMatchObject({ status: "awaiting_reply", followUps: 0 });
    expect(resent.sentAt).toBe(new Date(sentAt + 135 * DAY).toISOString());
    expect(sentTo(request.id)).toHaveLength(4);
    expect(sentTo(request.id)[3]?.mail.subject).not.toContain("Follow-up");

    const states = ctx.services.requests
      .events(request.id)
      .flatMap((event) => (event.type === "status_changed" ? [event.payload.to] : []));
    expect(states).toEqual([
      "queued",
      "sent",
      "awaiting_reply",
      "no_response",
      "follow_up_due",
      "queued",
      "sent",
      "awaiting_reply",
      "no_response",
      "follow_up_due",
      "queued",
      "sent",
      "awaiting_reply",
      "no_response",
      "queued",
      "sent",
      "awaiting_reply",
    ]);
  });

  it("is not followed up when the person allows no follow-ups", async () => {
    setSchedule({ maxFollowUps: 0 });
    const { request } = await sendRequest();
    ctx.clock.advance(46 * DAY);
    await scheduler.tick();
    expect(requestOf(request.id).status).toBe("no_response");
    expect(sentTo(request.id)).toHaveLength(1);

    ctx.clock.advance(45 * DAY);
    await scheduler.tick();
    expect(requestOf(request.id).status).toBe("awaiting_reply");
    expect(sentTo(request.id)).toHaveLength(2);
  });

  it("waits the person's own period before the follow-up when it is longer than the law's", async () => {
    setSchedule({ noResponseDays: 60 });
    const { request } = await sendRequest();
    ctx.clock.advance(46 * DAY);
    await scheduler.tick();
    expect(requestOf(request.id).status).toBe("no_response");
    expect(sentTo(request.id)).toHaveLength(1);

    ctx.clock.advance(14 * DAY);
    await scheduler.tick();
    expect(requestOf(request.id)).toMatchObject({ status: "awaiting_reply", followUps: 1 });
  });

  it("uses the schedule's resend period for brokers that stay silent", async () => {
    setSchedule({ maxFollowUps: 0, brokerRescanDays: 120 });
    const { request } = await sendRequest();
    ctx.clock.advance(100 * DAY);
    await scheduler.tick();
    expect(requestOf(request.id).status).toBe("no_response");
    ctx.clock.advance(20 * DAY);
    await scheduler.tick();
    expect(sentTo(request.id)).toHaveLength(2);
  });

  it("follows up with a company but never starts a company over", async () => {
    setSchedule({ maxFollowUps: 1 });
    const { request } = await sendRequest({ kind: "company" });
    ctx.clock.advance(45 * DAY);
    await scheduler.tick();
    expect(sentTo(request.id)).toHaveLength(2);
    ctx.clock.advance(300 * DAY);
    await scheduler.tick();
    expect(requestOf(request.id).status).toBe("no_response");
    expect(sentTo(request.id)).toHaveLength(2);
  });

  it("leaves a request that got an answer alone", async () => {
    const { request } = await sendRequest();
    ctx.services.requests.transition(request.id, "confirmed", { actor: "system" });
    ctx.clock.advance(400 * DAY);
    await scheduler.tick();
    expect(requestOf(request.id).status).toBe("confirmed");
    expect(sentTo(request.id)).toHaveLength(1);
  });

  it("does not follow up a rejected request, which is the person's to appeal", async () => {
    const { request } = await sendRequest();
    ctx.services.requests.transition(request.id, "rejected", { actor: "system" });
    ctx.clock.advance(400 * DAY);
    await scheduler.tick();
    expect(requestOf(request.id).status).toBe("rejected");
  });

  it("keeps a request without a mailbox at no_response instead of leaving it half moved", async () => {
    const { request } = await sendRequest();
    ctx.services.db.delete(mailboxes).where(eq(mailboxes.id, mailboxId)).run();
    ctx.clock.advance(46 * DAY);
    await scheduler.tick();
    expect(requestOf(request.id).status).toBe("no_response");
    expect(sentTo(request.id)).toHaveLength(1);
  });
});

describe("an unanswered form request", () => {
  async function submittedForm() {
    const target = seedTarget(ctx, {
      category: "people-search",
      contactMethod: "form",
      requirements: ["record_url"],
    });
    const recipe = seedRecipe(ctx, target.id, { purpose: "remove" });
    const { request, dispatch } = ctx.services.requests.open({
      profileId,
      targetId: target.id,
      rights: ["opt_out"],
      channel: "form",
      recordUrl: "https://records.test/p/1",
      actor: "user",
    });
    ctx.services.taskQueue.claim({ workerId: "w", kinds: ["form"], leaseMs: 60_000 });
    ctx.services.taskQueue.complete(dispatch.task.id, {
      workerId: "w",
      actor: "worker",
      result: { outcome: "submitted" },
    });
    return { request, recipe, target };
  }

  it("is never given an email follow-up, and is submitted again after the resend period", async () => {
    const { request } = await submittedForm();
    ctx.clock.advance(46 * DAY);
    await scheduler.tick();
    expect(requestOf(request.id).status).toBe("no_response");
    expect(ctx.mail.sent).toHaveLength(0);

    ctx.clock.advance(43 * DAY);
    await scheduler.tick();
    expect(requestOf(request.id).status).toBe("no_response");
    ctx.clock.advance(DAY);
    await scheduler.tick();

    expect(requestOf(request.id)).toMatchObject({ status: "queued", channel: "form" });
    const forms = ctx.services.taskQueue.list({ requestId: request.id, status: "queued" });
    expect(forms.map((task) => task.kind)).toEqual(["form"]);
    expect(
      ctx.services.requests
        .events(request.id)
        .filter((event) => event.type === "queued")
        .at(-1),
    ).toMatchObject({ payload: { channel: "form", reason: "resend" } });
  });

  it("says what is wrong on the request once when it cannot be sent again", async () => {
    const { request } = await submittedForm();
    ctx.services.db.delete(mailboxes).where(eq(mailboxes.id, mailboxId)).run();
    ctx.clock.advance(100 * DAY);
    await scheduler.tick();
    const failed = requestOf(request.id);
    expect(failed.status).toBe("no_response");
    expect(failed.lastError).toContain("mailbox");

    const eventsBefore = ctx.services.requests.events(request.id).length;
    await scheduler.tick();
    expect(ctx.services.requests.events(request.id)).toHaveLength(eventsBefore);
    expect(requestOf(request.id).updatedAt).toBe(failed.updatedAt);
  });
});

describe("advanceOverdueRequests", () => {
  it("only moves a request whose due date has passed", () => {
    const target = seedTarget(ctx);
    const now = ctx.clock.now().getTime();
    const dueSoon = seedRequest(ctx, {
      profileId,
      targetId: target.id,
      status: "awaiting_reply",
      sentAt: new Date(now - 10 * DAY).toISOString(),
      dueAt: new Date(now + MINUTE).toISOString(),
    });
    const overdue = seedRequest(ctx, {
      profileId,
      targetId: target.id,
      status: "awaiting_reply",
      sentAt: new Date(now - 50 * DAY).toISOString(),
      dueAt: new Date(now - MINUTE).toISOString(),
      followUps: 5,
    });
    const undated = seedRequest(ctx, {
      profileId,
      targetId: target.id,
      status: "awaiting_reply",
    });

    expect(advanceOverdueRequests(ctx.services)).toEqual({
      noResponse: 1,
      followUps: 0,
      resends: 0,
    });
    expect(requestOf(dueSoon.id).status).toBe("awaiting_reply");
    expect(requestOf(overdue.id).status).toBe("no_response");
    expect(requestOf(undated.id).status).toBe("awaiting_reply");
  });
});

describe("inbox polls", () => {
  it("queues a poll for a mailbox that was never polled, then waits the poll interval", async () => {
    await scheduler.tick();
    expect(ctx.services.db.select().from(mailboxes).get()?.lastPolledAt).toBe(
      ctx.clock.now().toISOString(),
    );

    ctx.clock.advance(14 * MINUTE);
    await scheduler.tick();
    expect(ctx.services.taskQueue.list({ kinds: ["inbox_poll"] })).toHaveLength(1);

    ctx.clock.advance(MINUTE);
    await scheduler.tick();
    expect(ctx.services.taskQueue.list({ kinds: ["inbox_poll"] })).toHaveLength(2);
  });

  it("honours the poll interval in the settings", async () => {
    setSchedule({ pollMinutes: 5 });
    await scheduler.tick();
    ctx.clock.advance(5 * MINUTE);
    await scheduler.tick();
    expect(ctx.services.taskQueue.list({ kinds: ["inbox_poll"] })).toHaveLength(2);
  });

  it("does not queue a second poll while one is waiting", async () => {
    const queueOnly = createScheduler(ctx.services, {
      runners: { runDue: async () => ({ polled: 0, sent: 0 }) } as never,
      housekeepingMs: 0,
    });
    await queueOnly.tick();
    ctx.clock.advance(HOUR);
    await queueOnly.tick();
    expect(ctx.services.taskQueue.list({ kinds: ["inbox_poll"] })).toHaveLength(1);
  });

  it("waits the interval after a failed poll instead of retrying every pass", async () => {
    const inbox = ctx.mail.services.inbox;
    ctx.mail.services.inbox = () => ({
      listFolders: async () => [],
      fetchSince: async () => {
        throw new Error("IMAP is down");
      },
    });
    await scheduler.tick();
    await scheduler.tick();
    ctx.mail.services.inbox = inbox;
    const polls = ctx.services.taskQueue.list({ kinds: ["inbox_poll"] });
    expect(polls).toHaveLength(1);
    expect(polls[0]?.status).toBe("failed");
  });
});

describe("re-scans", () => {
  function scannedTarget(overrides: Partial<Broker> = {}) {
    const target = seedTarget(ctx, { category: "people-search", ...overrides });
    seedScan(ctx, { profileId, targetId: target.id, finishedAt: ctx.clock.now().toISOString() });
    return target;
  }

  const liveScans = () =>
    ctx.services.taskQueue
      .list({ status: "queued" })
      .filter((task) => task.kind === "scan" || task.kind === "agent");

  it("scans a people-search target again after the re-scan period, and not before", async () => {
    const target = scannedTarget();
    ctx.clock.advance(59 * DAY);
    await scheduler.tick();
    expect(liveScans()).toHaveLength(0);

    ctx.clock.advance(DAY);
    await scheduler.tick();
    expect(liveScans()).toHaveLength(1);
    expect(liveScans()[0]).toMatchObject({ targetId: target.id, profileId });
  });

  it("uses the re-scan period from the settings", async () => {
    setSchedule({ peopleSearchRescanDays: 7 });
    scannedTarget();
    ctx.clock.advance(7 * DAY);
    await scheduler.tick();
    expect(liveScans()).toHaveLength(1);
  });

  it("measures from the latest scan, not the first", async () => {
    const target = scannedTarget();
    ctx.clock.advance(50 * DAY);
    seedScan(ctx, { profileId, targetId: target.id });
    ctx.clock.advance(20 * DAY);
    await scheduler.tick();
    expect(liveScans()).toHaveLength(0);
  });

  it("does not queue a re-scan while the last one is still running", async () => {
    scannedTarget();
    ctx.clock.advance(61 * DAY);
    await scheduler.tick();
    ctx.clock.advance(DAY);
    await scheduler.tick();
    expect(liveScans()).toHaveLength(1);
  });

  it("skips a target that left the dataset", async () => {
    scannedTarget();
    ctx.services.db.update(targets).set({ retired: true }).run();
    ctx.clock.advance(61 * DAY);
    await scheduler.tick();
    expect(liveScans()).toHaveLength(0);
  });

  it("only re-scans targets that list people", async () => {
    scannedTarget({ category: "marketing" });
    ctx.clock.advance(61 * DAY);
    await scheduler.tick();
    expect(liveScans()).toHaveLength(0);
  });
});

describe("canary checks", () => {
  const canaries = () => ctx.services.taskQueue.list({ kinds: ["canary"] });

  it("checks an approved recipe that was never checked, once a week", async () => {
    const target = seedTarget(ctx);
    const recipe = seedRecipe(ctx, target.id, { purpose: "remove" });
    await scheduler.tick();
    expect(canaries()).toHaveLength(1);
    expect(canaries()[0]).toMatchObject({
      payload: { recipeId: recipe.id },
      targetId: target.id,
      status: "queued",
    });

    ctx.clock.advance(6 * DAY);
    await scheduler.tick();
    expect(canaries()).toHaveLength(1);
  });

  it("queues the next week's check even when the last one is long finished", async () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { purpose: "remove" });
    await scheduler.tick();
    const first = canaries()[0];
    ctx.services.taskQueue.cancel(first?.id ?? "");

    ctx.clock.advance(7 * DAY);
    await scheduler.tick();
    expect(canaries()).toHaveLength(2);
  });

  it("does not queue a canary for a recipe that was used or checked within the week", async () => {
    const target = seedTarget(ctx);
    const recipe = seedRecipe(ctx, target.id, { purpose: "remove" });
    ctx.services.recipeHealth.recordRun(recipe.id, { ok: true });
    await scheduler.tick();
    expect(canaries()).toHaveLength(0);

    ctx.clock.advance(7 * DAY);
    await scheduler.tick();
    expect(canaries()).toHaveLength(1);
  });

  it("skips proposed and retired recipes", async () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { purpose: "remove", status: "pending_review" });
    seedRecipe(ctx, target.id, { purpose: "scan", status: "retired" });
    await scheduler.tick();
    expect(canaries()).toHaveLength(0);
  });

  it("still checks a recipe that is marked broken, which is how it can recover", async () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { purpose: "remove", health: "broken" });
    await scheduler.tick();
    expect(canaries()).toHaveLength(1);
  });
});

describe("housekeeping", () => {
  it("recovers a task whose lease ran out", async () => {
    const target = seedTarget(ctx);
    const task = seedTask(ctx, {
      kind: "canary",
      payload: { recipeId: seedRecipe(ctx, target.id).id },
      status: "leased",
      attempts: 1,
    });
    ctx.clock.advance(HOUR);
    await scheduler.tick();
    expect(ctx.services.taskQueue.getOrThrow(task.id)).toMatchObject({
      status: "queued",
      leaseOwner: null,
    });
  });

  it("deletes the artifacts of tasks that finished more than 30 days ago", async () => {
    const old = seedTask(ctx, {
      kind: "form",
      payload: { requestId: "r", targetId: "t", recipeId: null, recordUrl: null },
      status: "failed",
      screenshot: true,
    });
    ctx.clock.advance(20 * DAY);
    const recent = seedTask(ctx, {
      kind: "form",
      payload: { requestId: "r2", targetId: "t", recipeId: null, recordUrl: null },
      status: "failed",
      screenshot: true,
    });
    ctx.clock.advance(11 * DAY);

    await scheduler.tick();

    expect(ctx.services.taskQueue.screenshot(old.id)).toBeNull();
    expect(ctx.services.taskQueue.screenshot(recent.id)).not.toBeNull();
  });

  it("runs the slower jobs no more often than their interval", async () => {
    const throttled = createScheduler(ctx.services, {
      runners: { runDue: async () => ({ polled: 0, sent: 0 }) } as never,
      housekeepingMs: 60_000,
    });
    const spy = vi.spyOn(ctx.services.dispatch, "enqueueInboxPoll");
    await throttled.tick();
    await throttled.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    ctx.clock.advance(60_000);
    await throttled.tick();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("keeps running the other jobs when one throws", async () => {
    vi.spyOn(ctx.services.dispatch, "enqueueInboxPoll").mockImplementation(() => {
      throw new Error("boom");
    });
    const { request } = await sendRequest();
    expect(requestOf(request.id).status).toBe("awaiting_reply");
  });

  it("never runs two passes at once", async () => {
    const first = scheduler.tick();
    const second = scheduler.tick();
    expect(second).toBe(first);
    await first;
    expect(scheduler.tick()).not.toBe(first);
  });

  it("starts on a timer and stops, waiting for a pass in progress", async () => {
    const timed = createScheduler(ctx.services, {
      runners: createRunners(ctx.services, { random: () => 0 }),
      tickMs: 10,
      housekeepingMs: 0,
    });
    timed.start();
    timed.start();
    await vi.waitFor(() => {
      expect(ctx.services.db.select().from(mailboxes).get()?.lastPolledAt).not.toBeNull();
    });
    await timed.stop();
    const polls = ctx.services.taskQueue.list({ kinds: ["inbox_poll"] }).length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ctx.services.taskQueue.list({ kinds: ["inbox_poll"] })).toHaveLength(polls);
  });
});

describe("the registered scheduler", () => {
  it("is built with the server and stops when it closes", async () => {
    const running = await createTestContext({ env: { KICKROCKS_SCHEDULER: "on" } });
    expect(runnersOf(running.services).runDue).toBeTypeOf("function");
    await running.close();
  });

  it("starts nothing when the scheduler is off", async () => {
    const timers = vi.spyOn(globalThis, "setInterval");
    const off = await createTestContext();
    expect(off.services.config.schedulerEnabled).toBe(false);
    await off.close();
    expect(timers).not.toHaveBeenCalled();
  });
});

describe("requests are untouched by an idle scheduler", () => {
  it("changes nothing when nothing is due", async () => {
    const target = seedTarget(ctx);
    const request = seedRequest(ctx, { profileId, targetId: target.id, status: "draft" });
    await scheduler.tick();
    expect(
      ctx.services.db.select().from(requests).where(eq(requests.id, request.id)).get(),
    ).toMatchObject({
      status: "draft",
    });
  });
});
