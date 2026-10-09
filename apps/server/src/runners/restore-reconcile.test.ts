import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { API_ROUTES, outgoingMessageId } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RESTORE_MARKER, RESTORE_RETRY_MS } from "../core/restore-gate.js";
import {
  createTestContext,
  MINUTE,
  seedMailbox,
  seedProfile,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { createRunners, type Runners } from "./index.js";

let ctx: TestContext;
let profileId: string;
let mailboxAddress: string;
let runners: Runners;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  mailboxAddress = seedMailbox(ctx, profileId).address;
  runners = createRunners(ctx.services, { random: () => 0 });
});

afterEach(async () => {
  await ctx.close();
});

const sentFolder = { path: "Sent", name: "Sent", specialUse: "\\Sent" };
const domain = () => mailboxAddress.slice(mailboxAddress.lastIndexOf("@") + 1);
const mailbox = () => ctx.mail.mailbox(mailboxAddress);
const markRestored = () =>
  writeFileSync(
    join(ctx.services.config.dataDir, RESTORE_MARKER),
    `${ctx.clock.now().toISOString()}\n`,
  );
const requestOf = (id: string) => ctx.services.requests.getOrThrow(id);

function openRequest() {
  const target = seedTarget(ctx);
  const { request } = ctx.services.requests.open({
    profileId,
    targetId: target.id,
    rights: ["opt_out"],
    channel: "email",
    actor: "user",
  });
  return request;
}

const deliverSent = (requestId: string, sequence: number, to = "privacy@broker.test") =>
  mailbox().deliver({
    folder: "Sent",
    messageId: outgoingMessageId(requestId, domain(), sequence),
    from: { name: null, address: mailboxAddress },
    to: [to],
  });

describe("sending after a restore", () => {
  it("sends nothing while the restore marker is there", async () => {
    openRequest();
    markRestored();
    mailbox().folders = [...mailbox().folders];

    expect(await runners.email.runDue()).toBe(0);

    expect(ctx.mail.sent).toEqual([]);
    expect(ctx.services.restoreGate.state()).toMatchObject({ holding: true, problem: null });
  });

  it("records mail the Sent folder shows instead of sending it again, then lifts the hold", async () => {
    const request = openRequest();
    markRestored();
    mailbox().folders = [...mailbox().folders, sentFolder];
    deliverSent(request.id, 0, "legal@broker.test");

    await runners.runDue();

    expect(ctx.mail.sent).toEqual([]);
    expect(requestOf(request.id).status).toBe("awaiting_reply");
    expect(
      ctx.services.requests.events(request.id).find((event) => event.type === "sent"),
    ).toMatchObject({ payload: { foundInSent: true, kind: "initial" } });
    expect(ctx.services.restoreGate.holding()).toBe(false);
    expect(ctx.services.mailQuota.sentLastDay(requestOf(request.id).mailboxId as string)).toBe(1);
  });

  it("sends a request the Sent folder does not show once every mailbox has been checked", async () => {
    const request = openRequest();
    markRestored();
    mailbox().folders = [...mailbox().folders, sentFolder];

    await runners.runDue();

    expect(ctx.mail.sent).toHaveLength(1);
    expect(requestOf(request.id).status).toBe("awaiting_reply");
    expect(ctx.services.restoreGate.holding()).toBe(false);
  });

  it("lifts the hold at once when nothing is queued", async () => {
    markRestored();
    await runners.runDue();
    expect(ctx.services.restoreGate.holding()).toBe(false);
  });

  it("counts every send the old instance made since the backup, not only the first", async () => {
    const request = openRequest();
    await runners.email.runDue();
    ctx.clock.advance(MINUTE);
    ctx.services.requests.requeue(request.id, {
      actor: "system",
      reason: "follow_up",
      kind: "follow_up",
    });
    markRestored();
    mailbox().folders = [...mailbox().folders, sentFolder];
    deliverSent(request.id, 1);
    deliverSent(request.id, 2);
    const before = ctx.mail.sent.length;

    await runners.runDue();

    expect(ctx.mail.sent).toHaveLength(before);
    expect(requestOf(request.id)).toMatchObject({ status: "awaiting_reply", followUps: 2 });
  });

  it("stays held with the reason when the mailbox has no Sent folder, and checks again later", async () => {
    const request = openRequest();
    markRestored();

    await runners.runDue();

    expect(ctx.mail.sent).toEqual([]);
    expect(ctx.services.restoreGate.state()).toMatchObject({
      holding: true,
      problem: expect.stringContaining("no Sent folder"),
    });

    mailbox().folders = [...mailbox().folders, sentFolder];
    await runners.runDue();
    expect(ctx.services.restoreGate.holding()).toBe(true);

    ctx.clock.advance(RESTORE_RETRY_MS);
    await runners.runDue();
    expect(ctx.services.restoreGate.holding()).toBe(false);
    expect(requestOf(request.id).status).toBe("awaiting_reply");
  });

  it("resumes sending when the person confirms, and not before", async () => {
    openRequest();
    markRestored();
    await runners.runDue();
    expect(ctx.mail.sent).toEqual([]);

    const state = await ctx.call(API_ROUTES.restoreState);
    expect(state.ok && state.body).toMatchObject({ holding: true });
    const resumed = await ctx.call(API_ROUTES.restoreResume, { body: { confirm: true } });
    expect(resumed.ok && resumed.body).toMatchObject({ holding: false });

    await runners.email.runDue();
    expect(ctx.mail.sent).toHaveLength(1);
  });

  it("reports no hold on an instance that was not restored", async () => {
    const state = await ctx.call(API_ROUTES.restoreState);
    expect(state.ok && state.body).toEqual({ holding: false, restoredAt: null, problem: null });
  });
});
