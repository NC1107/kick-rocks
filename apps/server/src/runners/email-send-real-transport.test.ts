import { mailboxes } from "@kickrocks/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMailTransport } from "../mail/transport.js";
import {
  createTestContext,
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
  await smtp.close();
  await ctx.close();
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
  ctx.services.db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get()?.lastError;

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

  it("treats a connection dropped after DATA as a retry, not a permanent failure", async () => {
    smtp.behave("drop_after_data");
    const request = openRequest();

    await runners.email.runDue();

    expect(taskFor(request.id)?.status).not.toBe("failed");
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
});
