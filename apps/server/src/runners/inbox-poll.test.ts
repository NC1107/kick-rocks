import { mailboxes, messages, requests, targets, tasks } from "@kickrocks/db";
import { outgoingMessageId, type ReplyClassification } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClassificationResult, InboxMessage } from "../mail/types.js";
import {
  createTestContext,
  DAY,
  MINUTE,
  seedMailbox,
  seedProfile,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { createRunners, type Runners } from "./index.js";

let ctx: TestContext;
let profileId: string;
let mailboxId: string;
let runners: Runners;

const MAILBOX_ADDRESS = "jordan@example.com";

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  mailboxId = seedMailbox(ctx, profileId, { address: MAILBOX_ADDRESS }).id;
  runners = createRunners(ctx.services, { random: () => 0 });
});

afterEach(async () => {
  await ctx.close();
});

/** A request that went out by email and is waiting for the broker. */
async function sentRequest(targetOverrides: Parameters<typeof seedTarget>[1] = {}) {
  const target = seedTarget(ctx, targetOverrides);
  const { request } = ctx.services.requests.open({
    profileId,
    targetId: target.id,
    rights: ["opt_out"],
    channel: "email",
    actor: "user",
  });
  await runners.email.runDue();
  ctx.clock.advance(MINUTE);
  return { target, request: ctx.services.requests.getOrThrow(request.id) };
}

/** Programs the classifier to say that mail with this subject is `classification` for the request. */
function answer(
  subject: string,
  requestId: string | null,
  classification: ReplyClassification,
  extra: Partial<ClassificationResult> = {},
) {
  ctx.mail.classifier.when(subject, {
    requestId,
    correlation: requestId ? "reference" : null,
    classification,
    confidence: 0.9,
    rationale: "test",
    ...extra,
  });
}

const deliver = (subject: string, extra: Partial<InboxMessage> = {}) =>
  ctx.mail.mailbox(MAILBOX_ADDRESS).deliver({ subject, ...extra });

async function poll() {
  const queued = ctx.services.dispatch.enqueueInboxPoll(mailboxId);
  await runners.inbox.runDue();
  return ctx.services.taskQueue.getOrThrow(queued.task.id);
}

const stored = () =>
  ctx.services.db.select().from(messages).where(eq(messages.mailboxId, mailboxId)).all();
const requestOf = (id: string) => ctx.services.requests.getOrThrow(id);
const eventTypes = (id: string) => ctx.services.requests.events(id).map((event) => event.type);

describe("storing and applying replies", () => {
  it("confirms a request when the broker says it is done", async () => {
    const { request } = await sentRequest();
    answer("All done", request.id, "completed");
    deliver("All done", { text: "Your data has been deleted." });

    const task = await poll();

    expect(task.status).toBe("done");
    expect(requestOf(request.id).status).toBe("confirmed");
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({
      requestId: request.id,
      classification: "completed",
      reviewed: true,
      snippet: "Your data has been deleted.",
      text: "Your data has been deleted.",
    });
    expect(eventTypes(request.id).slice(-3)).toEqual([
      "reply_received",
      "classified",
      "status_changed",
    ]);
  });

  it.each([
    ["no_record", "no_record"],
    ["rejected", "rejected"],
    ["completed", "confirmed"],
  ] as const)(
    "moves a request to the status a %s reply stands for",
    async (classification, status) => {
      const { request } = await sentRequest();
      answer("Re: request", request.id, classification);
      deliver("Re: request");
      await poll();
      expect(requestOf(request.id).status).toBe(status);
    },
  );

  it("moves a request to needs_verification and keeps what the broker asked for", async () => {
    const { request } = await sentRequest();
    answer("Please verify", request.id, "verification_required", {
      requestedFields: ["date_of_birth", "street"],
    });
    deliver("Please verify");
    await poll();
    expect(requestOf(request.id).status).toBe("needs_verification");
    expect(stored()[0]?.requestedFields).toEqual(["date_of_birth", "street"]);
    expect(stored()[0]?.reviewed).toBe(true);
  });

  it("leaves a verification request with nothing to approve for a person to look at", async () => {
    const { request } = await sentRequest();
    answer("Please verify", request.id, "verification_required");
    deliver("Please verify");
    await poll();
    expect(requestOf(request.id).status).toBe("needs_verification");
    expect(stored()[0]?.reviewed).toBe(false);
  });

  it("only records an automatic acknowledgement", async () => {
    const { request } = await sentRequest();
    answer("Received", request.id, "auto_ack");
    deliver("Received");
    await poll();
    expect(requestOf(request.id).status).toBe("awaiting_reply");
    expect(eventTypes(request.id)).toContain("classified");
    expect(stored()[0]?.reviewed).toBe(true);
  });

  it("records a reply the state machine will not apply instead of forcing the move", async () => {
    const { request } = await sentRequest();
    ctx.services.requests.transition(request.id, "cancelled", { actor: "user" });
    answer("All done", request.id, "completed");
    deliver("All done");
    await poll();
    expect(requestOf(request.id).status).toBe("cancelled");
    expect(stored()[0]).toMatchObject({ requestId: request.id, classification: "completed" });
    expect(eventTypes(request.id)).toContain("classified");
  });

  it("applies a late reply to a request that had already gone quiet", async () => {
    const { request } = await sentRequest();
    ctx.services.requests.transition(request.id, "no_response", { actor: "system" });
    answer("All done", request.id, "completed");
    deliver("All done");
    await poll();
    expect(requestOf(request.id).status).toBe("confirmed");
  });

  it("holds low confidence mail for a person and changes nothing", async () => {
    const { request } = await sentRequest();
    answer("Hmm", request.id, "completed", { confidence: 0.4 });
    deliver("Hmm");
    await poll();
    expect(requestOf(request.id).status).toBe("awaiting_reply");
    expect(stored()[0]).toMatchObject({ requestId: request.id, reviewed: false, confidence: 0.4 });
    expect(eventTypes(request.id)).toContain("reply_received");
    expect(eventTypes(request.id)).not.toContain("classified");
  });

  it("holds mail it cannot match to a request unless it is plainly noise", async () => {
    answer("Order shipped", null, "unrelated");
    answer("Your request was processed", null, "completed");
    deliver("Order shipped");
    deliver("Your request was processed");
    await poll();
    const bySubject = Object.fromEntries(stored().map((row) => [row.subject, row.reviewed]));
    expect(bySubject).toEqual({ "Order shipped": true, "Your request was processed": false });
  });

  it("ignores a request id the classifier made up", async () => {
    const { request } = await sentRequest();
    answer("All done", "not-a-request", "completed");
    deliver("All done");
    await poll();
    expect(requestOf(request.id).status).toBe("awaiting_reply");
    expect(stored()[0]?.requestId).toBeNull();
  });

  it("keeps mail when the classifier fails", async () => {
    ctx.mail.classifier.program(() => {
      throw new Error("model offline");
    });
    deliver("Anything");
    const task = await poll();
    expect(task.status).toBe("done");
    expect(stored()[0]).toMatchObject({ classification: "unknown", reviewed: false });
    expect(stored()[0]?.rationale).toContain("model offline");
  });

  it("hands the classifier every request that could be answered, with what a form is waiting for", async () => {
    const { request } = await sentRequest();
    deliver("Anything");
    await poll();
    const context = ctx.mail.classifier.calls[0]?.context;
    expect(context?.requests).toEqual([
      expect.objectContaining({
        id: request.id,
        reference: request.reference,
        outgoingMessageId: request.outgoingMessageId,
        status: "awaiting_reply",
        channel: "email",
        awaitingConfirmation: null,
      }),
    ]);
  });
});

describe("confirmation links", () => {
  it("follows the link, writes it to the timeline, and stops waiting for the email", async () => {
    const { request, target } = await sentRequest();
    ctx.services.requests.update(request.id, {
      awaitingConfirmationSince: ctx.clock.now().toISOString(),
    });
    ctx.services.requests.addEvent(request.id, {
      type: "awaiting_confirmation",
      actor: "worker",
      payload: { fromDomains: ["sister.test"], linkTextPattern: null },
    });
    const link = `https://sister.test/confirm/${request.reference}`;
    answer("Confirm", request.id, "confirmation_link", { links: [link] });
    deliver("Confirm");

    await poll();

    expect(ctx.mail.linkFollower.calls).toEqual([
      { url: link, allowedDomains: [target.domain, "sister.test"] },
    ]);
    expect(
      ctx.services.requests.events(request.id).find((event) => event.type === "link_followed"),
    ).toMatchObject({ payload: { url: link, finalUrl: link, ok: true } });
    expect(requestOf(request.id).awaitingConfirmationSince).toBeNull();
    expect(stored()[0]?.reviewed).toBe(true);
  });

  it("leaves a company's deletion confirmation link for a person to decide", async () => {
    const target = seedTarget(ctx, { kind: "company", category: "retail" });
    const { request } = ctx.services.requests.open({
      profileId,
      targetId: target.id,
      rights: ["opt_out", "delete"],
      channel: "email",
      actor: "user",
    });
    await runners.email.runDue();
    ctx.clock.advance(MINUTE);
    answer("Verify deletion", request.id, "confirmation_link", {
      links: [`https://${target.domain}/verify-deletion`],
    });
    deliver("Verify deletion");

    await poll();

    expect(ctx.mail.linkFollower.calls).toEqual([]);
    expect(stored()[0]?.reviewed).toBe(false);
  });

  it("asks the browser to finish a link that needs a button press", async () => {
    const { request, target } = await sentRequest();
    const link = `https://${target.domain}/confirm?token=x`;
    ctx.mail.linkFollower.program(() => ({ needsBrowser: true }));
    answer("Confirm", request.id, "confirmation_link", { links: [link] });
    deliver("Confirm");
    await poll();
    const confirm = ctx.services.taskQueue
      .list({ requestId: request.id })
      .find((task) => task.kind === "confirm");
    expect(confirm).toMatchObject({
      status: "queued",
      payload: { requestId: request.id, url: link },
    });
    expect(stored()[0]?.reviewed).toBe(true);
  });

  it("tries the next link when one fails and says so when none works", async () => {
    const { request, target } = await sentRequest();
    const bad = `https://${target.domain}/a`;
    const good = `https://${target.domain}/b`;
    ctx.mail.linkFollower.program((url) => (url === bad ? { ok: false, reason: "404" } : null));
    answer("Confirm", request.id, "confirmation_link", { links: [bad, good] });
    deliver("Confirm");
    await poll();
    expect(ctx.mail.linkFollower.calls.map((call) => call.url)).toEqual([bad, good]);
    expect(stored()[0]?.reviewed).toBe(true);

    ctx.mail.linkFollower.reset();
    ctx.mail.linkFollower.program(() => ({ ok: false, reason: "404" }));
    answer("Confirm again", request.id, "confirmation_link", { links: [bad] });
    deliver("Confirm again");
    await poll();
    const failed = ctx.services.requests
      .events(request.id)
      .filter((event) => event.type === "link_followed");
    expect(failed.at(-1)).toMatchObject({ payload: { ok: false } });
    expect(stored().at(-1)?.reviewed).toBe(false);
  });

  it("survives a link follower that throws", async () => {
    const { request, target } = await sentRequest();
    ctx.mail.linkFollower.program(() => {
      throw new Error("socket hang up");
    });
    answer("Confirm", request.id, "confirmation_link", { links: [`https://${target.domain}/a`] });
    deliver("Confirm");
    const task = await poll();
    expect(task.status).toBe("done");
    expect(stored()[0]?.reviewed).toBe(false);
  });

  it("does not follow a link for a request the person cancelled", async () => {
    const { request, target } = await sentRequest();
    ctx.services.requests.transition(request.id, "cancelled", { actor: "user" });
    answer("Confirm", request.id, "confirmation_link", { links: [`https://${target.domain}/a`] });
    deliver("Confirm");
    await poll();
    expect(ctx.mail.linkFollower.calls).toHaveLength(0);
  });

  it("does not follow a link that is not a web address", async () => {
    const { request } = await sentRequest();
    answer("Confirm", request.id, "confirmation_link", { links: ["javascript:alert(1)"] });
    deliver("Confirm");
    await poll();
    expect(ctx.mail.linkFollower.calls).toHaveLength(0);
    expect(stored()[0]?.links).toEqual([]);
  });
});

describe("switching channel", () => {
  it("sends a bounced request through the broker's form", async () => {
    const { request } = await sentRequest({ contactMethod: "both" });
    answer("Undeliverable", request.id, "bounce");
    deliver("Undeliverable", { isBounce: true });

    await poll();

    const after = requestOf(request.id);
    expect(after).toMatchObject({ status: "queued", channel: "form" });
    const events = ctx.services.requests.events(request.id);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["channel_switched", "queued"]),
    );
    expect(events.find((event) => event.type === "channel_switched")).toMatchObject({
      payload: { from: "email", to: "form", reason: "bounce" },
    });
    expect(
      events
        .filter((event) => event.type === "status_changed")
        .map((event) => (event.type === "status_changed" ? event.payload.to : null)),
    ).toEqual(["queued", "sent", "awaiting_reply", "bounced", "queued"]);
    expect(ctx.services.taskQueue.hasLiveTask(request.id)).toBe(true);
  });

  it("leaves a bounced request bounced when the broker has no form", async () => {
    const { request } = await sentRequest({ contactMethod: "email", optOutUrl: null });
    answer("Undeliverable", request.id, "bounce");
    deliver("Undeliverable");
    await poll();
    expect(requestOf(request.id)).toMatchObject({ status: "bounced", channel: "email" });
    expect(stored()[0]?.reviewed).toBe(true);
  });

  it("leaves it bounced when the form cannot be reached for lack of a record", async () => {
    const { request } = await sentRequest({
      contactMethod: "both",
      category: "people-search",
    });
    answer("Undeliverable", request.id, "bounce");
    deliver("Undeliverable");
    await poll();
    expect(requestOf(request.id)).toMatchObject({ status: "bounced", channel: "email" });
    expect(stored()[0]?.reviewed).toBe(false);
  });

  it("follows a broker that says to use its web form", async () => {
    const { request } = await sentRequest({ contactMethod: "both" });
    answer("Use our form", request.id, "needs_form");
    deliver("Use our form");
    await poll();
    expect(requestOf(request.id)).toMatchObject({ status: "queued", channel: "form" });
    expect(
      ctx.services.requests.events(request.id).find((event) => event.type === "channel_switched"),
    ).toMatchObject({ payload: { reason: "needs_form" } });
  });

  it("asks a person when a broker wants its form and has none we can use", async () => {
    const { request } = await sentRequest({ contactMethod: "email", optOutUrl: null });
    answer("Use our form", request.id, "needs_form");
    deliver("Use our form");
    await poll();
    expect(requestOf(request.id)).toMatchObject({ status: "awaiting_reply", channel: "email" });
    expect(stored()[0]?.reviewed).toBe(false);
  });

  it("does not switch a retired broker's request", async () => {
    const { request, target } = await sentRequest({ contactMethod: "both" });
    ctx.services.db.update(targets).set({ retired: true }).where(eq(targets.id, target.id)).run();
    answer("Undeliverable", request.id, "bounce");
    deliver("Undeliverable");
    await poll();
    expect(requestOf(request.id).status).toBe("bounced");
  });
});

describe("what a poll reads", () => {
  it("does not store a message twice", async () => {
    deliver("One");
    await poll();
    await poll();
    expect(stored()).toHaveLength(1);
    expect(ctx.mail.classifier.calls).toHaveLength(1);
  });

  it("keeps a cursor so the next poll asks only for new mail", async () => {
    deliver("One");
    deliver("Two");
    await poll();
    const row = ctx.services.db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get();
    expect(row).toMatchObject({ lastPollUid: 2, uidValidity: 1, lastError: null });
    deliver("Three");
    await poll();
    expect(
      stored()
        .map((message) => message.subject)
        .sort(),
    ).toEqual(["One", "Three", "Two"]);
  });

  it("reads again from the start when the server renumbers the folder", async () => {
    deliver("One");
    await poll();
    ctx.mail.mailbox(MAILBOX_ADDRESS).resetUidValidity();
    deliver("Two");
    await poll();
    expect(
      stored()
        .map((message) => message.subject)
        .sort(),
    ).toEqual(["One", "Two"]);
    expect(
      ctx.services.db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get(),
    ).toMatchObject({ uidValidity: 2 });
  });

  it("never reads mail from before the oldest request still waiting", async () => {
    const { request } = await sentRequest();
    ctx.mail.mailbox(MAILBOX_ADDRESS).deliver({
      subject: "Old newsletter",
      date: new Date(Date.parse(request.sentAt ?? "") - 3 * DAY),
    });
    deliver("Fresh");
    await poll();
    expect(stored().map((message) => message.subject)).toEqual(["Fresh"]);
  });

  it("reads only today's mail when nothing is waiting", async () => {
    ctx.mail.mailbox(MAILBOX_ADDRESS).deliver({
      subject: "Last week",
      date: new Date(ctx.clock.now().getTime() - 7 * DAY),
    });
    deliver("Today");
    await poll();
    expect(stored().map((message) => message.subject)).toEqual(["Today"]);
  });

  it("skips the mail Kick Rocks sent itself", async () => {
    const { request } = await sentRequest();
    ctx.mail.mailbox(MAILBOX_ADDRESS).deliver({
      subject: "Our own copy",
      messageId: outgoingMessageId(request.id, "example.com", 3),
    });
    await poll();
    expect(stored()).toHaveLength(0);
  });

  it("drains a backlog over several pages in one poll", async () => {
    for (let index = 0; index < 120; index += 1) deliver(`Message ${index}`);
    const task = await poll();
    expect(stored()).toHaveLength(120);
    expect(task.result).toMatchObject({ fetched: 120, stored: 120, pages: 3 });
  });

  it("queues another poll when a backlog is too long for one", async () => {
    for (let index = 0; index < 520; index += 1) deliver(`Message ${index}`);
    await poll();
    const polls = ctx.services.taskQueue.list({ kinds: ["inbox_poll"] }).reverse();
    expect(polls.map((task) => task.result)).toMatchObject([{ fetched: 500 }, { fetched: 20 }]);
    expect(stored()).toHaveLength(520);
  });

  it("stamps the poll time and clears an earlier error", async () => {
    ctx.services.db
      .update(mailboxes)
      .set({ lastError: "old problem" })
      .where(eq(mailboxes.id, mailboxId))
      .run();
    await poll();
    expect(
      ctx.services.db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get(),
    ).toMatchObject({ lastError: null, lastPolledAt: ctx.clock.now().toISOString() });
  });

  it("records a connection failure on the mailbox and fails the poll without retrying it", async () => {
    const inbox = ctx.mail.services.inbox;
    ctx.mail.services.inbox = () => ({
      listFolders: async () => [],
      fetchSince: async () => {
        throw new Error("IMAP login failed");
      },
    });
    const task = await poll();
    ctx.mail.services.inbox = inbox;
    expect(task).toMatchObject({ status: "failed", lastError: "IMAP login failed" });
    expect(
      ctx.services.db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get(),
    ).toMatchObject({
      lastError: "IMAP login failed",
      lastPolledAt: ctx.clock.now().toISOString(),
    });
  });

  it("cancels a poll for a mailbox that no longer exists", async () => {
    const queued = ctx.services.dispatch.enqueueInboxPoll(mailboxId);
    ctx.services.db
      .update(tasks)
      .set({ payload: { mailboxId: "gone" } })
      .where(eq(tasks.id, queued.task.id))
      .run();
    await runners.inbox.runDue();
    expect(ctx.services.taskQueue.getOrThrow(queued.task.id).status).toBe("cancelled");
  });

  it("cuts a long message and a long subject down", async () => {
    deliver("S".repeat(900), { text: "x".repeat(30_000) });
    await poll();
    expect(stored()[0]?.text).toHaveLength(20_000);
    expect(stored()[0]?.subject).toHaveLength(500);
  });

  it("reads the folder the mailbox is configured to reply in", async () => {
    ctx.services.db
      .update(mailboxes)
      .set({ replyFolder: "Replies" })
      .where(eq(mailboxes.id, mailboxId))
      .run();
    ctx.mail.mailbox(MAILBOX_ADDRESS).deliver({ subject: "In inbox" });
    ctx.mail.mailbox(MAILBOX_ADDRESS).deliver({ subject: "In replies", folder: "Replies" });
    await poll();
    expect(stored().map((message) => message.subject)).toEqual(["In replies"]);
  });

  it("starts from the oldest request still waiting, not from one already settled", async () => {
    const first = await sentRequest();
    ctx.services.requests.transition(first.request.id, "confirmed", { actor: "user" });
    ctx.clock.advance(5 * DAY);
    await sentRequest();
    ctx.mail.mailbox(MAILBOX_ADDRESS).deliver({
      subject: "Between",
      date: new Date(ctx.clock.now().getTime() - 3 * DAY),
    });
    deliver("After");
    await poll();
    expect(stored().map((message) => message.subject)).toEqual(["After"]);
  });

  it("does not run on requests of another profile's mailbox", async () => {
    const other = seedProfile(ctx, { displayName: "Casey Example" });
    seedMailbox(ctx, other.id, { address: "casey@example.org" });
    const target = seedTarget(ctx);
    const { request } = ctx.services.requests.open({
      profileId: other.id,
      targetId: target.id,
      rights: ["opt_out"],
      channel: "email",
      actor: "user",
    });
    deliver("Hello");
    await poll();
    expect(ctx.mail.classifier.calls[0]?.context.requests.map((entry) => entry.id)).not.toContain(
      request.id,
    );
    expect(
      ctx.services.db.select().from(requests).where(eq(requests.id, request.id)).get()?.status,
    ).toBe("queued");
  });
});
