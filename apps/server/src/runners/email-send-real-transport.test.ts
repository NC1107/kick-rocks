import { mailboxes } from "@kickrocks/db";
import { API_ROUTES } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMailTransport } from "../mail/transport.js";
import { createScheduler } from "../scheduler/scheduler.js";
import {
  createTestContext,
  HOUR,
  MINUTE,
  SECOND,
  type SmtpSocketFake,
  seedMailbox,
  seedProfile,
  seedTarget,
  startSmtpSocketFake,
  type TestContext,
} from "../test-utils/index.js";
import { createRunners, type Runners } from "./index.js";
import { MAX_GAP_MS } from "./pacing.js";

let ctx: TestContext;
let smtp: SmtpSocketFake;
let runners: Runners;
let mailboxId: string;
let profileId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  smtp = await startSmtpSocketFake();
  profileId = seedProfile(ctx).id;
  mailboxId = seedMailbox(ctx, profileId, {
    smtpHost: "127.0.0.1",
    smtpPort: smtp.port,
    smtpSecure: false,
  }).id;
  ctx.mail.services.transport = (connection) =>
    createMailTransport(connection, { timeouts: { connectionMs: 300, socketMs: 2_000 } });
  runners = createRunners(ctx.services, { random: () => 0 });
});

afterEach(async () => {
  await smtp.close().catch(() => undefined);
  await ctx.close();
});

const saveMailbox = () =>
  ctx.call(API_ROUTES.mailboxSave, {
    params: { id: profileId },
    body: {
      provider: "fastmail",
      address: "jordan@example.com",
      username: "jordan@example.com",
      password: "fixed-app-password",
      smtpHost: "127.0.0.1",
      smtpPort: smtp.port,
      smtpSecure: false,
      imapHost: "127.0.0.1",
      imapPort: 1,
      replyFolder: "INBOX",
      dailyCap: 30,
    },
  });

function openRequest() {
  const target = seedTarget(ctx);
  return ctx.services.requests.open({
    profileId,
    targetId: target.id,
    rights: ["opt_out"],
    channel: "email",
    actor: "user",
  }).request;
}

const taskFor = (requestId: string) =>
  ctx.services.taskQueue.list({ requestId }).find((task) => task.kind === "email_send");
const lastError = () =>
  ctx.services.db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get()?.lastSendError;

describe("the email runner against the real transport", () => {
  it.each(["auth_rejected", "greeting_421", "silent"] as const)(
    "holds the mailbox on %s without spending an attempt, and says why",
    async (behavior) => {
      smtp.behave(behavior);
      const requests = [openRequest(), openRequest(), openRequest()];

      await runners.email.runDue();

      for (const request of requests) {
        expect(taskFor(request.id)).toMatchObject({ status: "queued", attempts: 0 });
      }
      expect(lastError()).toContain("Sending is paused");
      expect(ctx.services.mailHolds.until(mailboxId)).not.toBeNull();
      expect(smtp.connections()).toBe(1);
    },
  );

  it("holds the mailbox without spending an attempt when the port refuses the connection", async () => {
    await smtp.close();
    const request = openRequest();

    await runners.email.runDue();
    expect(taskFor(request.id)).toMatchObject({ status: "queued", attempts: 0 });
    expect(lastError()).toContain("Sending is paused");

    for (let hour = 0; hour < 12; hour += 1) {
      ctx.clock.advance(HOUR);
      await runners.email.runDue();
    }
    expect(taskFor(request.id)).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("recovers and sends once the server accepts again", async () => {
    smtp.behave("auth_rejected");
    const request = openRequest();
    await runners.email.runDue();

    smtp.behave("accept");
    ctx.clock.advance(70 * MINUTE);
    expect(await runners.email.runDue()).toBe(1);
    ctx.clock.advance(MAX_GAP_MS + SECOND);
    expect(taskFor(request.id)).toMatchObject({ status: "done" });
    expect(lastError()).toBeNull();
  });

  it("fails a refused recipient at once instead of retrying", async () => {
    smtp.behave("rcpt_550");
    const request = openRequest();

    await runners.email.runDue();

    expect(taskFor(request.id)).toMatchObject({
      status: "failed",
      failureKind: "site",
      attempts: 1,
    });
  });

  it("sends a message the server kept before dropping the connection at most maxAttempts times", async () => {
    smtp.behave("drop_after_data");
    const request = openRequest();

    for (let pass = 0; pass < 12; pass += 1) {
      await runners.email.runDue();
      ctx.clock.advance(HOUR);
    }

    const task = taskFor(request.id);
    expect(task?.status).toBe("failed");
    expect(smtp.received).toHaveLength(task?.maxAttempts ?? 0);
  });

  it("sends a message at most maxAttempts times when every restart cuts the send off after DATA", async () => {
    smtp.behave("stall_after_data");
    const request = openRequest();

    for (let round = 0; round < 6; round += 1) {
      const scheduler = createScheduler(ctx.services, {
        runners: createRunners(ctx.services, { random: () => 0 }),
        housekeepingMs: 0,
        retentionMs: 0,
      });
      const sentBefore = smtp.received.length;
      void scheduler.tick();
      if (taskFor(request.id)?.status !== "failed") {
        await vi
          .waitFor(() => expect(smtp.received.length).toBeGreaterThan(sentBefore), {
            timeout: 500,
          })
          .catch(() => undefined);
      }
      await scheduler.stop({ graceMs: 50 });
      ctx.clock.advance(HOUR);
    }

    const task = taskFor(request.id);
    expect(smtp.received.length).toBeLessThanOrEqual(task?.maxAttempts ?? 0);
    expect(task?.attempts).toBeGreaterThan(0);
  });

  it("retries a recipient the server deferred with a 450 instead of failing it", async () => {
    smtp.behave("rcpt_450");
    const request = openRequest();

    await runners.email.runDue();

    expect(taskFor(request.id)).toMatchObject({ status: "queued", attempts: 1 });
  });

  it("holds the mailbox when the server refuses the sender, without failing the request", async () => {
    smtp.behave("mail_from_553");
    const requests = [openRequest(), openRequest()];

    await runners.email.runDue();

    for (const request of requests) {
      expect(taskFor(request.id)).toMatchObject({ status: "queued", attempts: 0 });
    }
    expect(lastError()).toContain("Sending is paused");
    expect(smtp.connections()).toBe(1);
  });

  describe("the pass budget", () => {
    it("stops a pass after its task budget so the scheduler's other jobs are not starved", async () => {
      smtp.behave("accept");
      for (let n = 0; n < 25; n += 1) {
        const owner = seedProfile(ctx, { displayName: `Profile ${n}` });
        seedMailbox(ctx, owner.id, { smtpHost: "127.0.0.1", smtpPort: smtp.port });
        ctx.services.requests.open({
          profileId: owner.id,
          targetId: seedTarget(ctx).id,
          rights: ["opt_out"],
          channel: "email",
          actor: "user",
        });
      }

      await runners.email.runDue();

      expect(smtp.received).toHaveLength(20);
    });

    it("stops a pass once its time budget is spent", async () => {
      smtp.behave("accept");
      const slow = ctx.mail.services.transport;
      ctx.mail.services.transport = (connection) => ({
        ...slow(connection),
        send: async (outgoing) => {
          const result = await slow(connection).send(outgoing);
          ctx.clock.advance(2 * MINUTE);
          return result;
        },
      });
      const other = seedProfile(ctx, { displayName: "Other Profile" });
      seedMailbox(ctx, other.id, { smtpHost: "127.0.0.1", smtpPort: smtp.port });
      for (const owner of [profileId, other.id]) {
        ctx.services.requests.open({
          profileId: owner,
          targetId: seedTarget(ctx).id,
          rights: ["opt_out"],
          channel: "email",
          actor: "user",
        });
      }

      expect(await runners.email.runDue()).toBe(1);
    });
  });

  it("requeues the sends a revoked password failed once the mailbox is saved again", async () => {
    const request = openRequest();
    const claimed = ctx.services.taskQueue.claim({
      workerId: "server:email-send",
      kinds: ["email_send"],
      leaseMs: MINUTE,
    });
    ctx.services.taskQueue.fail(claimed?.id ?? "", {
      workerId: "server:email-send",
      error: "The server rejected the username or app password. The server said: 535 5.7.8",
      retryable: false,
      kind: "network",
      actor: "system",
    });
    expect(taskFor(request.id)?.status).toBe("failed");

    const saved = await saveMailbox();
    expect(saved.ok, JSON.stringify(saved)).toBe(true);

    expect(taskFor(request.id)).toMatchObject({ status: "queued", attempts: 0 });
    expect(await runners.email.runDue()).toBe(1);
  });

  it("leaves a send the broker refused failed when the mailbox is saved again", async () => {
    const request = openRequest();
    smtp.behave("rcpt_550");
    await runners.email.runDue();
    expect(taskFor(request.id)?.status).toBe("failed");

    await saveMailbox();

    expect(taskFor(request.id)?.status).toBe("failed");
  });
});
