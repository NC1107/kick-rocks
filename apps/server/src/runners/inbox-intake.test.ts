import { intakeSenders, mailboxes, messages, requestEvents, requests } from "@kickrocks/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplyClassifier } from "../mail/classifier.js";
import type { InboxMessage } from "../mail/types.js";
import { signedAs } from "../test-utils/dkim.js";
import {
  createTestContext,
  MINUTE,
  seedMailbox,
  seedProfile,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { createRunners, type Runners } from "./index.js";

const MAILBOX_ADDRESS = "jordan@example.com";

let ctx: TestContext;
let profileId: string;
let mailboxId: string;
let runners: Runners;

beforeEach(async () => {
  ctx = await createTestContext();
  (ctx.services.mail as { classifier: unknown }).classifier = createReplyClassifier({
    settings: ctx.services.settings,
  });
  profileId = seedProfile(ctx).id;
  mailboxId = seedMailbox(ctx, profileId, { address: MAILBOX_ADDRESS }).id;
  runners = createRunners(ctx.services, { random: () => 0 });
});

afterEach(async () => {
  await ctx.close();
});

const box = () => ctx.mail.mailbox(MAILBOX_ADDRESS);

const deliver = (overrides: Partial<InboxMessage>) =>
  box().deliver({ to: [MAILBOX_ADDRESS], text: "", ...overrides });

const from = (address: string) => ({ name: null, address });
const BULK = { "list-unsubscribe": "<mailto:unsubscribe@news.test>" };

async function sentRequest(
  target: Parameters<typeof seedTarget>[1],
  channel: "email" | "form" = "email",
  { drain = true }: { drain?: boolean } = {},
) {
  const seeded = seedTarget(ctx, target);
  const { request } = ctx.services.requests.open({
    profileId,
    targetId: seeded.id,
    rights: ["opt_out"],
    channel,
    actor: "user",
  });
  if (channel === "email") {
    await runners.email.runDue();
    ctx.clock.advance(MINUTE);
  }
  // The rescan a first send asks for runs before any mail is there, and would only blur the counts.
  if (drain) await runners.inbox.runDue();
  return ctx.services.requests.getOrThrow(request.id);
}

async function poll(rescan?: { since: string; targetId: string }) {
  const queued = ctx.services.dispatch.enqueueInboxPoll(mailboxId, rescan);
  await runners.inbox.runDue();
  return ctx.services.taskQueue.getOrThrow(queued.task.id);
}

const stored = () =>
  ctx.services.db.select().from(messages).where(eq(messages.mailboxId, mailboxId)).all();
const mailboxRow = () =>
  ctx.services.db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get();
const eventCount = () => ctx.services.db.select().from(requestEvents).all().length;

const SPOKEO = { kind: "broker", id: "spokeo", name: "Spokeo", domain: "spokeo.test" } as const;
const AMAZON = {
  kind: "company",
  id: "amazon",
  name: "Amazon",
  domain: "amazon.test",
  privacyEmail: "privacy@amazon.test",
} as const;

describe("what the poll lets in", () => {
  it("keeps nothing of mail that is not about a request, and the cursor passes it", async () => {
    await sentRequest(SPOKEO);
    await sentRequest(AMAZON);
    const before = eventCount();
    const logged: string[] = [];
    for (const level of ["info", "warn", "error", "debug"] as const) {
      vi.spyOn(ctx.services.logger, level).mockImplementation(((...args: unknown[]) => {
        logged.push(JSON.stringify(args));
      }) as never);
    }

    deliver({ subject: "Weekly digest zebra", from: from("news@letters.test"), headers: BULK });
    deliver({ subject: "Lunch on friday?", from: from("friend@elsewhere.test") });
    deliver({
      subject: "Your order has shipped",
      from: from("orders@amazon.test"),
      text: "Track your package.",
    });
    deliver({
      subject: "Spokeo sale",
      from: from("deals@spokeo.test"),
      headers: BULK,
      text: "Search anyone for less.",
    });
    const task = await poll();

    expect(stored()).toHaveLength(0);
    expect(eventCount()).toBe(before);
    expect(task.result).toMatchObject({ scanned: 4, kept: 0, ignored: 4, stored: 0 });
    expect(mailboxRow()).toMatchObject({
      lastPollUid: 4,
      lastPollScanned: 4,
      lastPollKept: 0,
    });
    expect(logged.join("\n")).not.toMatch(/zebra|friend@elsewhere|orders@amazon|Lunch|Spokeo sale/);
  });

  it("downloads only the messages it admits or has to read", async () => {
    const request = await sentRequest(SPOKEO);
    deliver({ subject: "Newsletter", from: from("news@letters.test"), headers: BULK });
    const reply = deliver({
      subject: "Re: your request",
      from: from("support@spokeo.test"),
      inReplyTo: request.outgoingMessageId,
      text: "We received your request.",
    });
    deliver({ subject: "Hello", from: from("friend@elsewhere.test"), text: "Hi there" });
    await poll();
    expect(box().fetched).toEqual([reply.uid]);
    expect(box().bodySearches.length).toBeGreaterThan(0);
  });

  it("stores why each message was taken in", async () => {
    const request = await sentRequest(SPOKEO);
    deliver({
      subject: "Re: Opt-out",
      from: from("someone@else.test"),
      inReplyTo: request.outgoingMessageId,
    });
    deliver({ subject: `About ${request.reference}`, from: from("a@b.test") });
    deliver({ subject: "Update", from: from("help@spokeo.test"), text: "Hello" });
    await poll();
    expect(
      stored()
        .map((row) => row.admittedBy)
        .sort(),
    ).toEqual(["reference", "target_sender", "thread"]);
  });

  it("keeps mail let in on its sender or wording for review when nothing recognises it", async () => {
    await sentRequest(SPOKEO);
    deliver({
      subject: "A tip",
      from: from("friend@elsewhere.test"),
      text: "I asked Spokeo to remove my personal information last week.",
    });
    deliver({ subject: "Thanks", from: from("noreply@spokeo.test"), text: "Cheers!" });
    const task = await poll();
    expect(stored().map((row) => [row.admittedBy, row.reviewed])).toEqual([
      ["named_target", false],
      ["target_sender", false],
    ]);
    expect(task.result).toMatchObject({ scanned: 2, kept: 2, ignored: 0, needsReview: 2 });
  });

  it("lets go of a sender-admitted newsletter only when it says nothing about privacy", async () => {
    const request = await sentRequest(SPOKEO);
    const entry = ctx.services.db.insert(intakeSenders);
    entry
      .values({
        id: crypto.randomUUID(),
        mailboxId,
        targetId: request.targetId,
        kind: "domain",
        value: "datasafe-support.net",
        createdAt: ctx.clock.now().toISOString(),
      })
      .run();
    deliver({
      subject: "Spring offers",
      from: from("promo@datasafe-support.net"),
      headers: BULK,
      text: "Save big this week.",
    });
    deliver({
      subject: "Your listing",
      from: from("promo@datasafe-support.net"),
      headers: BULK,
      text: "We removed your listing.",
    });
    await poll();
    expect(stored().map((row) => row.subject)).toEqual(["Your listing"]);
  });

  it("binds mail from a sender the person added to that target's request", async () => {
    const request = await sentRequest(SPOKEO);
    ctx.services.db
      .insert(intakeSenders)
      .values({
        id: crypto.randomUUID(),
        mailboxId,
        targetId: request.targetId,
        kind: "domain",
        value: "datasafe-support.net",
        createdAt: ctx.clock.now().toISOString(),
      })
      .run();
    deliver({
      subject: "Regarding your account",
      from: from("team@datasafe-support.net"),
      text: "We are looking into it and will write soon.",
    });
    await poll();
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({
      admittedBy: "target_sender",
      requestId: request.id,
      reviewed: false,
    });
  });

  it("reads a broker's bulk-mailed answer that says there are no records", async () => {
    const request = await sentRequest(SPOKEO);
    deliver({
      subject: "Update on your listing",
      from: from("updates@spokeo.test"),
      headers: BULK,
      text: "We found no records matching your information.",
    });
    deliver({
      subject: "Update on your listing",
      from: from("hello@email.spokeo.test"),
      text: "Your listing has been suppressed.",
    });
    await poll();
    expect(stored().map((row) => row.admittedBy)).toEqual(["target_sender", "target_sender"]);
    expect(stored().every((row) => row.requestId === request.id)).toBe(true);
  });

  it("still finds company mail and bulk reference mail on a server that matches whole words only", async () => {
    box().wholeWordSearch = true;
    const spokeo = await sentRequest(SPOKEO);
    await sentRequest(AMAZON);
    deliver({
      subject: "Update",
      from: from("help@amazon.test"),
      text: "We have deleted your records.",
    });
    deliver({
      subject: "Case update",
      from: from("noreply@mailer.example"),
      headers: BULK,
      text: `Reference ${spokeo.reference}: done.`,
    });
    deliver({
      subject: "Weekly digest",
      from: from("news@letters.test"),
      headers: BULK,
      text: "Nothing to see.",
    });
    await poll();
    expect(stored().map((row) => row.subject)).toEqual(["Update", "Case update"]);
  });

  it("sends mail that names an open target with a decision to Review, capped", async () => {
    await sentRequest(SPOKEO);
    deliver({
      subject: "Fwd: from Spokeo",
      from: from("friend@elsewhere.test"),
      text: "Spokeo says your data has been deleted from their listing.",
    });
    await poll();
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({
      admittedBy: "named_target",
      reviewed: false,
      requestId: null,
    });
    expect(stored()[0]?.confidence).toBeLessThanOrEqual(0.55);
  });

  it("reaches the same outcome when the server refuses SEARCH", async () => {
    const request = await sentRequest(SPOKEO);
    const messagesToDeliver = () => {
      deliver({ subject: "Newsletter", from: from("news@letters.test"), headers: BULK });
      deliver({
        subject: "Case",
        from: from("billing@somewhere.test"),
        text: `Receipt for ${request.reference}`,
        headers: BULK,
      });
      deliver({ subject: "Hello", from: from("friend@elsewhere.test"), text: "Hi" });
    };
    messagesToDeliver();
    await poll();
    const withSearch = stored().map((row) => [row.subject, row.admittedBy]);

    ctx.services.db.delete(messages).run();
    box().searchSupported = false;
    ctx.services.db.update(mailboxes).set({ lastPollUid: null }).run();
    await poll();
    expect(stored().map((row) => [row.subject, row.admittedBy])).toEqual(withSearch);
    expect(withSearch).toEqual([["Case", "reference"]]);
  });
});

describe("a confirmation that arrives before the request is waiting for it", () => {
  it("is picked up by the rescan the wait sets off", async () => {
    const request = await sentRequest(SPOKEO, "form");
    const confirmation = deliver({
      subject: "Please confirm your email address",
      from: from("noreply@spokeo.test"),
      headers: BULK,
      verifyDkim: signedAs("spokeo.test", {}),
      html: '<p>Please confirm your email address.</p><a href="https://spokeo.test/email/confirm?t=abc">Confirm</a>',
      text: "Please confirm your email address: https://spokeo.test/email/confirm?t=abc",
    });
    await poll();
    expect(stored()).toHaveLength(0);
    expect(mailboxRow()?.lastPollUid).toBe(confirmation.uid);

    ctx.services.requests.transition(request.id, "awaiting_reply", {
      actor: "system",
      patch: {
        sentAt: ctx.clock.now().toISOString(),
        awaitingConfirmationSince: ctx.clock.now().toISOString(),
      },
    });
    ctx.services.requests.addEvent(request.id, {
      type: "awaiting_confirmation",
      actor: "system",
      payload: { fromDomains: ["spokeo.test"], linkTextPattern: null },
    });
    const task = await poll({
      since: new Date(ctx.clock.now().getTime() - 15 * MINUTE).toISOString(),
      targetId: SPOKEO.id,
    });

    expect(task.result).toMatchObject({ kept: 1 });
    expect(stored()[0]).toMatchObject({
      admittedBy: "awaiting_confirmation",
      classification: "confirmation_link",
      requestId: request.id,
    });
    const confirms = ctx.services.taskQueue
      .list({ requestId: request.id })
      .filter((task) => task.kind === "confirm");
    expect(confirms).toMatchObject([
      { payload: { url: "https://spokeo.test/email/confirm?t=abc" } },
    ]);
  });

  it("is queued when a request starts waiting and when an email request is first sent", async () => {
    const request = await sentRequest(SPOKEO, "email", { drain: false });
    const polls = ctx.services.taskQueue.list({ kinds: ["inbox_poll"] });
    expect(polls.map((task) => task.payload)).toContainEqual({
      mailboxId,
      rescan: { since: expect.any(String), targetId: request.targetId },
    });
  });
});

describe("mail that shares a sender with a request without being about it", () => {
  const accountMail = {
    subject: "Confirm your new email address",
    from: from("account-update@amazon.test"),
    html: '<p>Please confirm your email address to finish the change.</p><a href="https://amazon.test/ap/confirm?token=abc">Confirm email address</a>',
    text: "Please confirm your email address: https://amazon.test/ap/confirm?token=abc",
  };

  it("never follows an account link, because the gate does not take the mail in", async () => {
    await sentRequest(AMAZON);
    deliver(accountMail);
    await poll();
    expect(stored()).toHaveLength(0);
    expect(ctx.mail.linkFollower.calls).toHaveLength(0);
  });

  it("never follows it either when the person took in all company mail", async () => {
    const request = await sentRequest(AMAZON);
    ctx.services.db.update(mailboxes).set({ companyMail: "all" }).run();
    deliver(accountMail);
    await poll();
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ requestId: request.id, reviewed: false });
    expect(stored()[0]?.confidence).toBeLessThan(0.6);
    expect(ctx.mail.linkFollower.calls).toHaveLength(0);
    expect(ctx.services.db.select().from(requests).get()?.status).not.toBe("confirmed");
  });
});
