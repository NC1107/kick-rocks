import { requestEvents } from "@kickrocks/db";
import { API_ROUTES, RequestStatus, reviewAttention } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  DAY,
  MINUTE,
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

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

async function dashboard(profileId: string) {
  const result = await ctx.call(API_ROUTES.dashboardGet, { params: { id: profileId } });
  if (!result.ok) throw new Error(`dashboard failed: ${JSON.stringify(result.body)}`);
  return result.body;
}

function eventCount(requestId: string): number {
  return ctx.services.db
    .select()
    .from(requestEvents)
    .where(eq(requestEvents.requestId, requestId))
    .all().length;
}

const emailPayload = (requestId: string) => ({
  requestId,
  kind: "initial" as const,
  fields: [],
  inReplyTo: null,
});

describe("GET /profiles/:id/dashboard", () => {
  it("is empty for a new profile, with every status present at zero", async () => {
    const profile = seedProfile(ctx);

    const result = await dashboard(profile.id);

    expect(result).toEqual({
      profileId: profile.id,
      total: 0,
      counts: Object.fromEntries(RequestStatus.options.map((status) => [status, 0])),
      attention: {
        blockedTasks: 0,
        pendingMatches: 0,
        unreviewedMessages: 0,
        needsVerification: 0,
        failedTasks: 0,
        agentTasks: 0,
      },
      sending: null,
      mailbox: null,
      recentEvents: [],
    });
  });

  it("counts the profile's requests by status and leaves other profiles out", async () => {
    const profile = seedProfile(ctx);
    const other = seedProfile(ctx, { displayName: "Sam Example" });
    seedTarget(ctx, { id: "b" });
    for (const status of ["queued", "queued", "confirmed", "needs_verification"] as const) {
      seedRequest(ctx, { profileId: profile.id, targetId: "b", status });
    }
    seedRequest(ctx, { profileId: other.id, targetId: "b", status: "confirmed" });

    const result = await dashboard(profile.id);

    expect(result.total).toBe(4);
    expect(result.counts).toMatchObject({
      queued: 2,
      confirmed: 1,
      needs_verification: 1,
      sent: 0,
    });
    expect(result.attention.needsVerification).toBe(0);
  });

  it("counts exactly what the review queue lists, including tasks waiting for an agent", async () => {
    const profile = seedProfile(ctx);
    seedTarget(ctx, { id: "b" });
    const request = seedRequest(ctx, {
      profileId: profile.id,
      targetId: "b",
      status: "needs_verification",
    });
    seedTask(ctx, {
      kind: "agent",
      payload: {
        purpose: "remove",
        profileId: profile.id,
        targetId: "b",
        requestId: request.id,
        recordUrl: "https://b.test/1",
        variant: null,
        rights: ["opt_out"],
        reason: "no_recipe",
        previousError: null,
        blockedReason: null,
      },
      profileId: profile.id,
      targetId: "b",
      requestId: request.id,
    });

    const attention = (await dashboard(profile.id)).attention;
    const queue = await ctx.call(API_ROUTES.reviewQueue, { query: { profileId: profile.id } });
    if (!queue.ok) throw new Error("queue failed");

    expect(attention.agentTasks).toBe(1);
    expect(attention).toEqual(reviewAttention(queue.body));
  });

  it("counts what waits for the person, for this profile only", async () => {
    const profile = seedProfile(ctx);
    const mailbox = seedMailbox(ctx, profile.id);
    const other = seedProfile(ctx, { displayName: "Sam Example" });
    const otherMailbox = seedMailbox(ctx, other.id);
    seedTarget(ctx, { id: "b", category: "people-search" });
    const scan = seedScan(ctx, { profileId: profile.id, targetId: "b" });
    const otherScan = seedScan(ctx, { profileId: other.id, targetId: "b" });

    seedMatch(ctx, { scanId: scan.id, profileId: profile.id, targetId: "b", decision: "pending" });
    seedMatch(ctx, {
      scanId: scan.id,
      profileId: profile.id,
      targetId: "b",
      decision: "mine",
      recordUrl: "https://b.test/2",
    });
    seedMatch(ctx, { scanId: otherScan.id, profileId: other.id, targetId: "b" });

    seedMessage(ctx, { mailboxId: mailbox.id, reviewed: false });
    seedMessage(ctx, { mailboxId: mailbox.id, reviewed: false });
    seedMessage(ctx, { mailboxId: mailbox.id, reviewed: true });
    seedMessage(ctx, { mailboxId: otherMailbox.id, reviewed: false });

    const blocked = (profileId: string) =>
      seedTask(ctx, {
        kind: "scan",
        status: "blocked",
        blockedReason: "captcha",
        payload: { profileId, targetId: "b", recipeId: null, variant: null },
        profileId,
        targetId: "b",
      });
    blocked(profile.id);
    blocked(profile.id);
    blocked(other.id);

    const result = await dashboard(profile.id);

    expect(result.attention).toEqual({
      blockedTasks: 2,
      pendingMatches: 1,
      unreviewedMessages: 2,
      needsVerification: 0,
      failedTasks: 0,
      agentTasks: 0,
    });
  });

  describe("failedTasks", () => {
    function failedFor(profileId: string, requestId: string | null, targetId = "b") {
      return seedTask(ctx, {
        kind: requestId ? "email_send" : "scan",
        status: "failed",
        lastError: "boom",
        payload: requestId
          ? emailPayload(requestId)
          : { profileId, targetId, recipeId: null, variant: null },
        profileId,
        targetId,
        requestId,
      });
    }

    it("counts a final failure on an open request and on a scan, which has no request", async () => {
      const profile = seedProfile(ctx);
      seedTarget(ctx, { id: "b" });
      const open = seedRequest(ctx, { profileId: profile.id, targetId: "b", status: "queued" });
      failedFor(profile.id, open.id);
      failedFor(profile.id, null);

      expect((await dashboard(profile.id)).attention.failedTasks).toBe(2);
    });

    it("counts only what the review page lists, so a failed canary and a replaced failure do not add up", async () => {
      const profile = seedProfile(ctx);
      seedTarget(ctx, { id: "b" });
      failedFor(profile.id, null);
      seedTask(ctx, {
        kind: "canary",
        status: "failed",
        lastError: "boom",
        payload: { recipeId: "b.remove.v1" },
        profileId: profile.id,
        targetId: "b",
      });

      const queue = await ctx.call(API_ROUTES.reviewQueue, { query: { profileId: profile.id } });
      if (!queue.ok) throw new Error("review queue failed");
      expect((await dashboard(profile.id)).attention.failedTasks).toBe(
        queue.body.failedTasks.length,
      );
    });

    it("leaves out failures whose request is closed, including a rejected one", async () => {
      const profile = seedProfile(ctx);
      seedTarget(ctx, { id: "b" });
      for (const status of ["confirmed", "no_record", "cancelled", "rejected"] as const) {
        failedFor(
          profile.id,
          seedRequest(ctx, { profileId: profile.id, targetId: "b", status }).id,
        );
      }

      expect((await dashboard(profile.id)).attention.failedTasks).toBe(0);
    });

    it("leaves out failures older than 30 days and tasks that did not fail", async () => {
      const profile = seedProfile(ctx);
      seedTarget(ctx, { id: "b" });
      failedFor(profile.id, null);
      ctx.clock.advance(29 * DAY);
      expect((await dashboard(profile.id)).attention.failedTasks).toBe(1);
      ctx.clock.advance(2 * DAY);
      expect((await dashboard(profile.id)).attention.failedTasks).toBe(0);

      seedTask(ctx, {
        kind: "scan",
        status: "done",
        payload: { profileId: profile.id, targetId: "b", recipeId: null, variant: null },
        profileId: profile.id,
        targetId: "b",
      });
      expect((await dashboard(profile.id)).attention.failedTasks).toBe(0);
    });
  });

  describe("sending and mailbox", () => {
    it("reports today's sends against the cap from the mail quota", async () => {
      const profile = seedProfile(ctx);
      const mailbox = seedMailbox(ctx, profile.id, { dailyCap: 5, lastError: "auth failed" });
      seedTarget(ctx, { id: "b" });
      const request = seedRequest(ctx, { profileId: profile.id, targetId: "b" });
      for (let i = 0; i < 2; i += 1) {
        ctx.services.mailQuota.record({
          mailboxId: mailbox.id,
          requestId: request.id,
          kind: "initial",
          messageId: `<m${i}@example.test>`,
        });
      }

      const result = await dashboard(profile.id);

      expect(result.sending).toEqual({ sent: 2, cap: 5, remaining: 3 });
      expect(result.mailbox).toEqual({
        address: mailbox.address,
        lastPolledAt: null,
        lastError: "auth failed",
      });
    });

    it("stops counting a send after a rolling 24 hours", async () => {
      const profile = seedProfile(ctx);
      const mailbox = seedMailbox(ctx, profile.id, { dailyCap: 5 });
      seedTarget(ctx, { id: "b" });
      const request = seedRequest(ctx, { profileId: profile.id, targetId: "b" });
      ctx.services.mailQuota.record({
        mailboxId: mailbox.id,
        requestId: request.id,
        kind: "initial",
        messageId: "<old@example.test>",
      });

      ctx.clock.advance(DAY - MINUTE);
      expect((await dashboard(profile.id)).sending).toEqual({ sent: 1, cap: 5, remaining: 4 });
      ctx.clock.advance(2 * MINUTE);
      expect((await dashboard(profile.id)).sending).toEqual({ sent: 0, cap: 5, remaining: 5 });
    });

    it("shows when the mailbox was last polled", async () => {
      const profile = seedProfile(ctx);
      seedMailbox(ctx, profile.id, { lastPolledAt: "2026-10-06T12:00:00.000Z" });

      expect((await dashboard(profile.id)).mailbox?.lastPolledAt).toBe("2026-10-06T12:00:00.000Z");
    });
  });

  describe("recentEvents", () => {
    it("lists the newest events first with the request reference and target name", async () => {
      const profile = seedProfile(ctx);
      seedMailbox(ctx, profile.id);
      seedTarget(ctx, { id: "b", name: "Example Broker" });
      const { request } = ctx.services.requests.open({
        profileId: profile.id,
        targetId: "b",
        rights: ["opt_out"],
        channel: "email",
        actor: "user",
      });

      const { recentEvents } = await dashboard(profile.id);

      expect(recentEvents).toHaveLength(1);
      expect(recentEvents[0]).toMatchObject({
        type: "task_enqueued",
        eventCount: 4,
        requestId: request.id,
        requestReference: request.reference,
        targetName: "Example Broker",
      });
    });

    it("keeps every request visible and counted when one request has 300 events", async () => {
      const profile = seedProfile(ctx);
      seedTarget(ctx, { id: "b" });
      const quiet = seedRequest(ctx, { profileId: profile.id, targetId: "b" });
      ctx.clock.advance(MINUTE);
      const noisy = seedRequest(ctx, { profileId: profile.id, targetId: "b" });
      const baseline = eventCount(noisy.id);
      for (let i = 0; i < 300; i += 1) {
        ctx.clock.advance(MINUTE);
        ctx.services.requests.addEvent(noisy.id, {
          type: "note",
          actor: "user",
          payload: { text: `n${i}` },
        });
      }

      const { recentEvents } = await dashboard(profile.id);

      expect(recentEvents.map((event) => event.requestId)).toEqual([noisy.id, quiet.id]);
      expect(recentEvents[0]).toMatchObject({ type: "note", eventCount: baseline + 300 });
      expect(recentEvents[1]?.eventCount).toBe(eventCount(quiet.id));
    });

    it("orders by time across requests and covers the latest twenty requests", async () => {
      const profile = seedProfile(ctx);
      seedTarget(ctx, { id: "b" });
      const requests = Array.from({ length: 12 }, () => {
        const request = seedRequest(ctx, { profileId: profile.id, targetId: "b" });
        ctx.clock.advance(MINUTE);
        return request;
      });
      for (const request of requests) {
        ctx.services.requests.addEvent(request.id, {
          type: "note",
          actor: "user",
          payload: { text: `note for ${request.reference}` },
        });
        ctx.clock.advance(MINUTE);
      }

      const { recentEvents } = await dashboard(profile.id);

      expect(recentEvents).toHaveLength(12);
      expect(recentEvents.map((event) => event.requestId)).toEqual(
        [...requests].reverse().map((request) => request.id),
      );
      const times = recentEvents.map((event) => event.createdAt);
      expect(times).toEqual([...times].sort().reverse());
    });

    it("covers only the twenty most recently active requests", async () => {
      const profile = seedProfile(ctx);
      seedTarget(ctx, { id: "b" });
      for (let i = 0; i < 25; i += 1) {
        seedRequest(ctx, { profileId: profile.id, targetId: "b" });
        ctx.clock.advance(MINUTE);
      }

      const { recentEvents } = await dashboard(profile.id);

      expect(recentEvents).toHaveLength(20);
    });

    it("leaves out other profiles' events", async () => {
      const profile = seedProfile(ctx);
      const other = seedProfile(ctx, { displayName: "Sam Example" });
      seedTarget(ctx, { id: "b" });
      seedRequest(ctx, { profileId: other.id, targetId: "b" });

      expect((await dashboard(profile.id)).recentEvents).toEqual([]);
    });
  });

  it("answers 404 for a profile that does not exist", async () => {
    const result = await ctx.call(API_ROUTES.dashboardGet, { params: { id: "missing" } });
    expect(result).toMatchObject({ ok: false, status: 404, body: { error: "profile_not_found" } });
  });

  it("needs a session", async () => {
    const profile = seedProfile(ctx);
    ctx.auth.deny();
    const result = await ctx.call(API_ROUTES.dashboardGet, { params: { id: profile.id } });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });
});
