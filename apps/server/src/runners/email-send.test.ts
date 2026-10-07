import { mailboxes, outgoingMail, requests, targets, tasks } from "@kickrocks/db";
import { POLICY_RESPONSE_DAYS, parseOutgoingMessageId } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  DAY,
  HOUR,
  MINUTE,
  SECOND,
  seedMailbox,
  seedProfile,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { createRunners, type Runners } from "./index.js";
import { MAX_GAP_MS, MIN_GAP_MS } from "./pacing.js";

let ctx: TestContext;
let profileId: string;
let mailboxId: string;
let runners: Runners;

const useRandom = (value: number) => {
  runners = createRunners(ctx.services, { random: () => value });
};

beforeEach(async () => {
  ctx = await createTestContext();
  const profile = seedProfile(ctx);
  profileId = profile.id;
  mailboxId = seedMailbox(ctx, profileId, { dailyCap: 30 }).id;
  useRandom(0);
});

afterEach(async () => {
  await ctx.close();
});

function openRequest(profile = profileId, targetOverrides: Parameters<typeof seedTarget>[1] = {}) {
  const target = seedTarget(ctx, targetOverrides);
  const { request } = ctx.services.requests.open({
    profileId: profile,
    targetId: target.id,
    rights: ["opt_out"],
    channel: "email",
    actor: "user",
  });
  return { target, request };
}

const requestOf = (id: string) => ctx.services.requests.getOrThrow(id);
const taskFor = (requestId: string) =>
  ctx.services.taskQueue.list({ requestId }).find((task) => task.kind === "email_send");
const statusesOf = (id: string) =>
  ctx.services.requests
    .events(id)
    .filter((event) => event.type === "status_changed")
    .map((event) => (event.type === "status_changed" ? event.payload.to : null));

describe("sending a first request", () => {
  it("sends the composed mail, records it, and moves the request to awaiting_reply", async () => {
    const { target, request } = openRequest();

    expect(await runners.email.runDue()).toBe(1);

    expect(ctx.mail.sent).toHaveLength(1);
    const { mail, connection } = ctx.mail.sent[0] ?? { mail: null, connection: null };
    expect(mail).toMatchObject({
      to: target.privacyEmail,
      from: { address: "jordan@example.com" },
    });
    expect(mail?.subject).toContain(request.reference);
    expect(connection?.password).toBe("fake-app-password");
    expect(parseOutgoingMessageId(mail?.messageId ?? "")).toEqual({
      requestId: request.id,
      sequence: 0,
      domain: "example.com",
    });

    const after = requestOf(request.id);
    expect(after).toMatchObject({
      status: "awaiting_reply",
      outgoingMessageId: mail?.messageId,
      sentAt: ctx.clock.now().toISOString(),
      followUps: 0,
      mailboxId,
    });
    expect(statusesOf(request.id)).toEqual(["queued", "sent", "awaiting_reply"]);
    expect(ctx.services.mailQuota.sentLastDay(mailboxId)).toBe(1);
    expect(taskFor(request.id)?.status).toBe("done");
  });

  it("writes a sent event naming the message, mailbox, and kind", async () => {
    const { request } = openRequest();
    await runners.email.runDue();
    const sent = ctx.services.requests.events(request.id).find((event) => event.type === "sent");
    expect(sent).toMatchObject({
      type: "sent",
      actor: "system",
      payload: {
        channel: "email",
        kind: "initial",
        messageId: requestOf(request.id).outgoingMessageId,
        mailboxId,
      },
    });
  });

  it("sets the due date from the legal basis the request cited", async () => {
    ctx.legal.getLegalBasis = (id, state) => ({
      id,
      kind: "statute",
      state,
      statute: null,
      responseDays: 30,
    });
    const { request } = openRequest();
    await runners.email.runDue();
    const after = requestOf(request.id);
    expect(after.dueAt).toBe(new Date(ctx.clock.now().getTime() + 30 * DAY).toISOString());
    expect(after.followUpAt).toBe(
      new Date(ctx.clock.now().getTime() + POLICY_RESPONSE_DAYS * DAY).toISOString(),
    );
  });

  it("waits for the person's own no-response period when it is longer than the law's", async () => {
    ctx.services.settings.set("schedule", {
      ...ctx.services.settings.get("schedule"),
      noResponseDays: 60,
    });
    const { request } = openRequest();
    await runners.email.runDue();
    const after = requestOf(request.id);
    expect(after.dueAt).toBe(
      new Date(ctx.clock.now().getTime() + POLICY_RESPONSE_DAYS * DAY).toISOString(),
    );
    expect(after.followUpAt).toBe(new Date(ctx.clock.now().getTime() + 60 * DAY).toISOString());
  });

  it("ignores a task whose request has moved on and cancels it", async () => {
    const { request } = openRequest();
    ctx.services.db
      .update(requests)
      .set({ status: "awaiting_reply" })
      .where(eq(requests.id, request.id))
      .run();

    expect(await runners.email.runDue()).toBe(0);

    expect(ctx.mail.sent).toHaveLength(0);
    expect(taskFor(request.id)?.status).toBe("cancelled");
  });

  it("does not send for a request that was cancelled", async () => {
    const { request } = openRequest();
    ctx.services.requests.transition(request.id, "cancelled", { actor: "user" });
    expect(await runners.email.runDue()).toBe(0);
    expect(ctx.mail.sent).toHaveLength(0);
  });
});

describe("pacing", () => {
  it("sends one mail per mailbox per pass and waits the gap before the next", async () => {
    const first = openRequest().request;
    const second = openRequest().request;

    expect(await runners.email.runDue()).toBe(1);
    expect(requestOf(first.id).status).toBe("awaiting_reply");
    expect(requestOf(second.id).status).toBe("queued");

    ctx.clock.advance(MIN_GAP_MS - SECOND);
    expect(await runners.email.runDue()).toBe(0);

    ctx.clock.advance(SECOND);
    expect(await runners.email.runDue()).toBe(1);
    expect(requestOf(second.id).status).toBe("awaiting_reply");
  });

  it.each([
    [0, MIN_GAP_MS],
    [0.5, MIN_GAP_MS + (MAX_GAP_MS - MIN_GAP_MS) / 2],
    [1, MAX_GAP_MS],
  ])("draws a gap between 20 and 60 seconds (random %s gives %s ms)", async (random, gap) => {
    useRandom(random);
    openRequest();
    const second = openRequest().request;
    await runners.email.runDue();

    ctx.clock.advance(gap - 1);
    expect(await runners.email.runDue()).toBe(0);
    ctx.clock.advance(1);
    expect(await runners.email.runDue()).toBe(1);
    expect(requestOf(second.id).status).toBe("awaiting_reply");
  });

  it("uses the gap the configuration sets, so a development stack can send without waiting", async () => {
    await ctx.close();
    ctx = await createTestContext({ env: { KICKROCKS_SEND_GAP_MS: "0" } });
    profileId = seedProfile(ctx).id;
    mailboxId = seedMailbox(ctx, profileId, { dailyCap: 30 }).id;
    useRandom(0);
    openRequest();
    openRequest();

    expect(await runners.email.runDue()).toBe(2);
  });

  it("keeps the gap it drew for a send, whatever the randomness does afterwards", async () => {
    let value = 0;
    runners = createRunners(ctx.services, { random: () => value });
    openRequest();
    openRequest();
    await runners.email.runDue();
    const lastSent = ctx.services.mailQuota.lastSentAt(mailboxId);

    value = 1;
    const wait = runners.email.pacer.waitUntil({ id: mailboxId, dailyCap: 30 });
    expect(wait?.getTime()).toBe((lastSent?.getTime() ?? 0) + MIN_GAP_MS);
  });

  it("never lets one mailbox's gap hold up another profile's mail", async () => {
    const other = seedProfile(ctx, { displayName: "Casey Example" });
    seedMailbox(ctx, other.id, { address: "casey@example.org" });
    openRequest(profileId);
    openRequest(profileId);
    openRequest(other.id);

    expect(await runners.email.runDue()).toBe(2);
    expect(ctx.mail.sent.map((entry) => entry.mail.from.address).sort()).toEqual([
      "casey@example.org",
      "jordan@example.com",
    ]);
  });

  it("stops at the daily cap and resumes when the oldest send leaves the 24 hour window", async () => {
    ctx.services.db.update(mailboxes).set({ dailyCap: 2 }).where(eq(mailboxes.id, mailboxId)).run();
    const ids = [openRequest().request, openRequest().request, openRequest().request].map(
      (request) => request.id,
    );

    await runners.email.runDue();
    ctx.clock.advance(MAX_GAP_MS);
    await runners.email.runDue();
    const secondSentAt = ctx.clock.now();
    expect(ctx.mail.sent).toHaveLength(2);

    ctx.clock.advance(HOUR);
    expect(await runners.email.runDue()).toBe(0);
    expect(requestOf(ids[2] as string).status).toBe("queued");
    expect(ctx.services.mailQuota.remaining(mailboxId)).toBe(0);

    // The first send was at t0, so a slot opens 24 hours after it, not after the second.
    ctx.clock.set(new Date(secondSentAt.getTime() - MAX_GAP_MS + DAY - SECOND));
    expect(await runners.email.runDue()).toBe(0);
    ctx.clock.advance(SECOND);
    expect(await runners.email.runDue()).toBe(1);
    expect(requestOf(ids[2] as string).status).toBe("awaiting_reply");
  });

  it("counts a rolling day, not a calendar day", async () => {
    ctx.services.db.update(mailboxes).set({ dailyCap: 1 }).where(eq(mailboxes.id, mailboxId)).run();
    openRequest();
    const second = openRequest().request;
    ctx.clock.set("2026-10-07T23:50:00.000Z");
    await runners.email.runDue();

    ctx.clock.set("2026-10-08T00:10:00.000Z");
    expect(await runners.email.runDue()).toBe(0);
    ctx.clock.set("2026-10-08T23:49:59.000Z");
    expect(await runners.email.runDue()).toBe(0);
    ctx.clock.set("2026-10-08T23:50:00.000Z");
    expect(await runners.email.runDue()).toBe(1);
    expect(requestOf(second.id).status).toBe("awaiting_reply");
  });

  it("does not spend an attempt on a send that had to wait", async () => {
    openRequest();
    const second = openRequest().request;
    await runners.email.runDue();
    await runners.email.runDue();
    expect(taskFor(second.id)).toMatchObject({ status: "queued", attempts: 0 });
  });
});

describe("when sending fails", () => {
  it("retries a transient failure after a backoff without losing the request", async () => {
    const { request } = openRequest();
    ctx.mail.failNextSend(new Error("connection reset"));

    expect(await runners.email.runDue()).toBe(0);

    expect(requestOf(request.id).status).toBe("queued");
    expect(taskFor(request.id)).toMatchObject({ status: "queued", attempts: 1 });
    const events = ctx.services.requests.events(request.id);
    expect(events.find((event) => event.type === "send_failed")).toMatchObject({
      payload: { error: "connection reset", willRetry: true },
    });
    expect(events.some((event) => event.type === "task_retrying")).toBe(true);
    expect(ctx.services.mailQuota.sentLastDay(mailboxId)).toBe(0);

    expect(await runners.email.runDue()).toBe(0);
    ctx.clock.advance(MINUTE);
    expect(await runners.email.runDue()).toBe(1);
    expect(requestOf(request.id).status).toBe("awaiting_reply");
  });

  it("gives up after the attempts are used and leaves the failure on the request", async () => {
    const { request } = openRequest();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      ctx.mail.failNextSend(new Error("connection reset"));
      await runners.email.runDue();
      ctx.clock.advance(HOUR);
    }
    expect(taskFor(request.id)?.status).toBe("failed");
    expect(requestOf(request.id)).toMatchObject({
      status: "queued",
      lastError: "connection reset",
    });
    const failures = ctx.services.requests
      .events(request.id)
      .filter((event) => event.type === "send_failed");
    expect(
      failures.map((event) => (event.type === "send_failed" ? event.payload.willRetry : null)),
    ).toEqual([true, true, false]);
  });

  it("does not retry a refusal that asking again cannot change", async () => {
    const { request } = openRequest();
    ctx.mail.failNextSend(Object.assign(new Error("550 no such user"), { responseCode: 550 }));
    await runners.email.runDue();
    expect(taskFor(request.id)).toMatchObject({
      status: "failed",
      failureKind: "site",
      attempts: 1,
    });
    expect(
      ctx.services.requests.events(request.id).find((event) => event.type === "send_failed"),
    ).toMatchObject({ payload: { willRetry: false } });
  });

  describe("when the mailbox cannot reach its server or log in", () => {
    function breakTransport(code: string) {
      const transport = ctx.mail.services.transport;
      ctx.mail.services.transport = (connection) => ({
        ...transport(connection),
        send: async () => {
          throw Object.assign(new Error(`${code} from the server`), { code });
        },
      });
      return () => {
        ctx.mail.services.transport = transport;
      };
    }

    it.each(["ECONNECTION", "ETIMEDOUT", "EAUTH"])(
      "pauses the whole mailbox on %s and spends no attempts",
      async (code) => {
        const requestsOpen = [openRequest().request, openRequest().request, openRequest().request];
        const repair = breakTransport(code);

        for (let tick = 0; tick < 10; tick += 1) {
          await runners.email.runDue();
          ctx.clock.advance(5 * SECOND);
        }

        for (const request of requestsOpen) {
          expect(taskFor(request.id)).toMatchObject({ status: "queued", attempts: 0 });
        }
        expect(
          ctx.services.db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get()
            ?.lastError,
        ).toContain("Sending is paused");

        repair();
        ctx.clock.advance(HOUR);
        for (let round = 0; round < 3; round += 1) {
          await runners.email.runDue();
          ctx.clock.advance(MAX_GAP_MS);
        }
        expect(ctx.mail.sent).toHaveLength(3);
        expect(
          ctx.services.db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get()
            ?.lastError,
        ).toBeNull();
      },
    );

    it("waits longer after each failure in a row", async () => {
      openRequest();
      breakTransport("ECONNECTION");
      await runners.email.runDue();
      const first = runners.email.pacer.waitUntil({ id: mailboxId, dailyCap: 30 });
      ctx.clock.advance(10 * MINUTE);
      await runners.email.runDue();
      const second = runners.email.pacer.waitUntil({ id: mailboxId, dailyCap: 30 });
      expect((second?.getTime() ?? 0) - ctx.clock.now().getTime()).toBeGreaterThan(
        (first?.getTime() ?? 0) - (ctx.clock.now().getTime() - 10 * MINUTE),
      );
    });
  });

  it("fails when the server accepts nobody", async () => {
    const { request } = openRequest();
    const transport = ctx.mail.services.transport;
    ctx.mail.services.transport = (connection) => ({
      ...transport(connection),
      send: async (mail) => ({ messageId: mail.messageId, accepted: [], rejected: [mail.to] }),
    });
    await runners.email.runDue();
    expect(taskFor(request.id)).toMatchObject({ status: "failed", failureKind: "site" });
    expect(requestOf(request.id).status).toBe("queued");
    ctx.mail.services.transport = transport;
  });

  it("fails without sending when the mail cannot be composed", async () => {
    const { target, request } = openRequest();
    ctx.services.db
      .update(targets)
      .set({ privacyEmail: null })
      .where(eq(targets.id, target.id))
      .run();

    await runners.email.runDue();

    expect(ctx.mail.sent).toHaveLength(0);
    expect(taskFor(request.id)).toMatchObject({ status: "failed", failureKind: "internal" });
    expect(requestOf(request.id).lastError).toContain("no email address");
  });

  it("never stores the mailbox password in an error", async () => {
    const { request } = openRequest();
    ctx.mail.failNextSend(new Error("auth failed"));
    await runners.email.runDue();
    const row = ctx.services.db.select().from(tasks).where(eq(tasks.requestId, request.id)).get();
    expect(JSON.stringify(row)).not.toContain("fake-app-password");
  });
});

describe("follow-ups and verification replies", () => {
  async function sentRequest() {
    const { request, target } = openRequest();
    await runners.email.runDue();
    ctx.clock.advance(MINUTE);
    return { request: requestOf(request.id), target };
  }

  it("sends a follow-up in the same thread and counts it", async () => {
    const { request } = await sentRequest();
    ctx.services.requests.requeue(request.id, {
      actor: "system",
      reason: "follow_up",
      kind: "follow_up",
    });
    await runners.email.runDue();

    const followUp = ctx.mail.sent[1]?.mail;
    expect(followUp?.subject).toContain("Follow-up");
    expect(followUp?.inReplyTo).toBe(request.outgoingMessageId);
    expect(followUp?.references).toEqual([request.outgoingMessageId]);
    expect(parseOutgoingMessageId(followUp?.messageId ?? "")?.sequence).toBe(1);

    const after = requestOf(request.id);
    expect(after).toMatchObject({
      status: "awaiting_reply",
      followUps: 1,
      sentAt: request.sentAt,
      outgoingMessageId: request.outgoingMessageId,
    });
    expect(
      ctx.services.requests.events(request.id).find((event) => event.type === "follow_up_sent"),
    ).toMatchObject({ payload: { messageId: followUp?.messageId, number: 1 } });
    expect(Date.parse(after.dueAt ?? "")).toBeGreaterThan(ctx.clock.now().getTime());
  });

  it("sends a verification reply with only the approved fields, answering the broker's message", async () => {
    const { request } = await sentRequest();
    ctx.services.db
      .update(requests)
      .set({ status: "needs_verification" })
      .where(eq(requests.id, request.id))
      .run();
    ctx.services.requests.requeue(request.id, {
      actor: "user",
      reason: "verification_reply",
      kind: "verification_reply",
      fields: ["date_of_birth"],
      inReplyTo: "<broker-1@broker.test>",
    });
    await runners.email.runDue();

    const reply = ctx.mail.sent[1]?.mail;
    expect(reply?.text).toContain("date_of_birth: 1990-04-05");
    expect(reply?.inReplyTo).toBe("<broker-1@broker.test>");
    expect(reply?.references).toEqual(["<broker-1@broker.test>", request.outgoingMessageId]);
    expect(
      ctx.services.requests
        .events(request.id)
        .find((event) => event.type === "sent" && event.payload.kind === "verification_reply"),
    ).toBeDefined();
    expect(requestOf(request.id)).toMatchObject({ status: "awaiting_reply", followUps: 0 });
  });

  it("starts the follow-up count over when the request is sent again from scratch", async () => {
    const { request } = await sentRequest();
    ctx.services.db.update(requests).set({ followUps: 2 }).where(eq(requests.id, request.id)).run();
    ctx.services.db
      .update(requests)
      .set({ status: "rejected" })
      .where(eq(requests.id, request.id))
      .run();
    ctx.services.requests.requeue(request.id, {
      actor: "user",
      reason: "resend",
      kind: "initial",
    });
    await runners.email.runDue();
    const after = requestOf(request.id);
    expect(after.followUps).toBe(0);
    expect(after.outgoingMessageId).not.toBe(request.outgoingMessageId);
    expect(after.sentAt).toBe(ctx.clock.now().toISOString());
  });
});

describe("a request changed while its mail was on the way", () => {
  it("keeps the send on record without forcing the request back to awaiting_reply", async () => {
    const { request } = openRequest();
    const transport = ctx.mail.services.transport;
    ctx.mail.services.transport = (connection) => ({
      ...transport(connection),
      send: async (mail) => {
        ctx.services.requests.transition(request.id, "cancelled", { actor: "user" });
        return { messageId: mail.messageId, accepted: [mail.to], rejected: [] };
      },
    });
    await runners.email.runDue();
    ctx.mail.services.transport = transport;

    expect(requestOf(request.id).status).toBe("cancelled");
    expect(ctx.services.db.select().from(outgoingMail).all()).toHaveLength(1);
    expect(ctx.services.requests.events(request.id).some((event) => event.type === "sent")).toBe(
      true,
    );
  });
});

describe("a request moved without its task being cancelled while mail was on the way", () => {
  it("finishes the task so its lease cannot expire and send the mail twice", async () => {
    const { request } = openRequest();
    const transport = ctx.mail.services.transport;
    ctx.mail.services.transport = (connection) => ({
      ...transport(connection),
      send: async (mail) => {
        ctx.services.db
          .update(requests)
          .set({ status: "awaiting_reply" })
          .where(eq(requests.id, request.id))
          .run();
        return { messageId: mail.messageId, accepted: [mail.to], rejected: [] };
      },
    });
    await runners.email.runDue();
    ctx.mail.services.transport = transport;

    expect(taskFor(request.id)?.status).toBe("done");
    ctx.clock.advance(HOUR);
    ctx.services.taskQueue.reapExpiredLeases();
    await runners.email.runDue();
    expect(ctx.services.mailQuota.sentLastDay(mailboxId)).toBe(1);
    expect(taskFor(request.id)?.attempts).toBe(1);
  });
});

describe("seeded requests", () => {
  it("sends nothing for a request that is only a draft", async () => {
    const target = seedTarget(ctx);
    seedRequest(ctx, { profileId, targetId: target.id, status: "draft" });
    expect(await runners.runDue()).toEqual({ polled: 0, sent: 0 });
  });
});
