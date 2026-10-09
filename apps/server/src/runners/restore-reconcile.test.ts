import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tasks } from "@kickrocks/db";
import { API_ROUTES, outgoingMessageId } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RESTORE_MARKER, RESTORE_RETRY_MS } from "../core/restore-gate.js";
import { BACKUP_TAKEN_AT, JOURNAL_CARRIED } from "../core/sent-journal.js";
import {
  createTestContext,
  HOUR,
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
const sentCount = () => ctx.mail.sent.length;

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

/**
 * A send made before the backup, filed in the Sent folder or not, which is how the check learns
 * whether this mailbox keeps the mail that is sent through it.
 */
async function sendEarlier(keptInSent: boolean) {
  const earlier = openRequest();
  await runners.email.runDue();
  if (keptInSent) deliverSent(earlier.id, 0);
  // The gap between a mailbox's sends has passed by the time the instance is restored.
  ctx.clock.advance(HOUR);
  return earlier;
}

/** What `install.sh --restore` leaves when it carries the journal over from the volume it replaced. */
function carryJournal() {
  writeFileSync(
    join(ctx.services.config.dataDir, BACKUP_TAKEN_AT),
    `${ctx.clock.now().toISOString()}\n`,
  );
  writeFileSync(join(ctx.services.config.dataDir, JOURNAL_CARRIED), "");
}

const deliverSent = (requestId: string, sequence: number, to = "privacy@broker.test") =>
  mailbox().deliver({
    folder: "Sent",
    messageId: outgoingMessageId(requestId, domain(), sequence),
    from: { name: null, address: mailboxAddress },
    to: [to],
  });

describe("sending after a restore", () => {
  beforeEach(() => {
    mailbox().folders = [...mailbox().folders, sentFolder];
  });

  it("sends nothing while the restore marker is there", async () => {
    openRequest();
    markRestored();

    expect(await runners.email.runDue()).toBe(0);

    expect(ctx.mail.sent).toEqual([]);
    expect(ctx.services.restoreGate.state()).toMatchObject({ holding: true, problem: null });
  });

  it("records mail the Sent folder shows instead of sending it again, then lifts the hold", async () => {
    await sendEarlier(true);
    const request = openRequest();
    markRestored();
    deliverSent(request.id, 0, "legal@broker.test");
    const before = sentCount();

    await runners.runDue();

    expect(sentCount()).toBe(before);
    expect(requestOf(request.id).status).toBe("awaiting_reply");
    expect(
      ctx.services.requests.events(request.id).find((event) => event.type === "sent"),
    ).toMatchObject({ payload: { foundInSent: true, kind: "initial" } });
    expect(ctx.services.restoreGate.holding()).toBe(false);
    expect(ctx.services.mailQuota.sentLastDay(requestOf(request.id).mailboxId as string)).toBe(2);
  });

  it("sends a request the Sent folder does not show once every mailbox has been checked", async () => {
    await sendEarlier(true);
    const request = openRequest();
    markRestored();
    const before = sentCount();

    await runners.runDue();

    expect(sentCount()).toBe(before + 1);
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
    deliverSent(request.id, 0);
    ctx.clock.advance(MINUTE);
    ctx.services.requests.requeue(request.id, {
      actor: "system",
      reason: "follow_up",
      kind: "follow_up",
    });
    markRestored();
    deliverSent(request.id, 1);
    deliverSent(request.id, 2);
    const before = sentCount();

    await runners.runDue();

    expect(sentCount()).toBe(before);
    expect(requestOf(request.id)).toMatchObject({ status: "awaiting_reply", followUps: 2 });
  });

  it("stays held with the reason when the mailbox has no Sent folder, and checks again later", async () => {
    await sendEarlier(true);
    const request = openRequest();
    markRestored();
    const mail = mailbox();
    const folders = mail.folders;
    mail.folders = folders.filter((folder) => folder.specialUse !== "\\Sent");
    const before = sentCount();

    await runners.runDue();

    expect(sentCount()).toBe(before);
    expect(ctx.services.restoreGate.state()).toMatchObject({
      holding: true,
      problem: expect.stringContaining("no Sent folder"),
    });

    mail.folders = folders;
    await runners.runDue();
    expect(ctx.services.restoreGate.holding()).toBe(true);

    ctx.clock.advance(RESTORE_RETRY_MS);
    await runners.runDue();
    expect(ctx.services.restoreGate.holding()).toBe(false);
    expect(requestOf(request.id).status).toBe("awaiting_reply");
  });

  it("keeps holding when the Sent folder does not record sends, because an empty folder then proves nothing", async () => {
    await sendEarlier(false);
    const request = openRequest();
    markRestored();
    const before = sentCount();

    await runners.runDue();

    expect(sentCount()).toBe(before);
    expect(requestOf(request.id).status).toBe("queued");
    expect(ctx.services.restoreGate.state()).toMatchObject({
      holding: true,
      problem: expect.stringContaining("this mailbox does not keep sent mail"),
    });
  });

  it("keeps holding for a mailbox that has sent nothing before, since its folder cannot be proven", async () => {
    openRequest();
    markRestored();

    await runners.runDue();

    expect(ctx.mail.sent).toEqual([]);
    expect(ctx.services.restoreGate.state()).toMatchObject({
      holding: true,
      problem: expect.stringContaining("Sent folder keeps sent mail"),
    });
  });

  it("settles from the send journal that was carried over, without reading the Sent folder", async () => {
    await sendEarlier(false);
    const request = openRequest();
    markRestored();
    carryJournal();
    ctx.services.sentJournal.append({
      requestId: request.id,
      ref: outgoingMessageId(request.id, domain(), 0),
      channel: "email",
      recipient: "legal@broker.test",
    });
    const before = sentCount();

    await runners.runDue();

    expect(sentCount()).toBe(before);
    expect(requestOf(request.id).status).toBe("awaiting_reply");
    expect(
      ctx.services.requests.events(request.id).find((event) => event.type === "sent"),
    ).toMatchObject({ payload: { foundInJournal: true } });
    expect(ctx.services.restoreGate.holding()).toBe(false);
  });

  it("sends a request the carried journal does not show, even on a mailbox that files nothing in Sent", async () => {
    await sendEarlier(false);
    const request = openRequest();
    markRestored();
    carryJournal();
    const before = sentCount();

    await runners.runDue();

    expect(sentCount()).toBe(before + 1);
    expect(requestOf(request.id).status).toBe("awaiting_reply");
    expect(ctx.services.restoreGate.holding()).toBe(false);
  });

  it("does not trust a journal that only came out of the archive", async () => {
    await sendEarlier(false);
    openRequest();
    markRestored();

    await runners.runDue();

    expect(ctx.services.restoreGate.holding()).toBe(true);
  });

  it("clears the mark of a cut-off send that a trusted Sent folder does not hold", async () => {
    await sendEarlier(true);
    const request = openRequest();
    const task = ctx.services.taskQueue.list({ kinds: ["email_send"], status: "queued" })[0];
    ctx.services.db
      .update(tasks)
      .set({ unconfirmedMessageId: outgoingMessageId(request.id, domain(), 0) })
      .where(eq(tasks.id, task?.id as string))
      .run();
    markRestored();

    await runners.runDue();

    expect(
      ctx.services.db
        .select({ id: tasks.unconfirmedMessageId })
        .from(tasks)
        .where(eq(tasks.id, task?.id as string))
        .get()?.id,
    ).toBeNull();
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
