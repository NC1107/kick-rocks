import { intakeSenders, mailboxes, messages } from "@kickrocks/db";
import { API_ROUTES } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  seedMailbox,
  seedProfile,
  seedTarget,
  type TestContext,
} from "../../test-utils/index.js";
import { enableReplyAlias } from "./intake.js";

let ctx: TestContext;
let profileId: string;
let mailboxId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  mailboxId = seedMailbox(ctx, profileId, { provider: "fastmail" }).id;
});
afterEach(async () => {
  await ctx.close();
});

const row = () => ctx.services.db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get();

describe("what Kick Rocks takes in", () => {
  it("switches company mail between privacy-only and all", async () => {
    const all = await ctx.call(API_ROUTES.mailboxIntake, {
      params: { id: profileId },
      body: { companyMail: "all" },
    });
    expect(all).toMatchObject({ ok: true, body: { companyMail: "all" } });
    expect(row()?.companyMail).toBe("all");
  });

  it("reports the last check as counts only", async () => {
    ctx.services.db
      .update(mailboxes)
      .set({ lastPollScanned: 143, lastPollKept: 4 })
      .where(eq(mailboxes.id, mailboxId))
      .run();
    const saved = await ctx.call(API_ROUTES.mailboxIntake, {
      params: { id: profileId },
      body: { companyMail: "privacy_only" },
    });
    expect(saved).toMatchObject({ ok: true, body: { lastPollScanned: 143, lastPollKept: 4 } });
  });
});

describe("the notice about removed mail", () => {
  it("shows once after the cleanup removed mail and can be dismissed", async () => {
    ctx.services.db
      .update(mailboxes)
      .set({ intakeCleanupRemoved: 111, intakeCleanupAt: ctx.clock.now().toISOString() })
      .where(eq(mailboxes.id, mailboxId))
      .run();
    const shown = await ctx.call(API_ROUTES.mailboxIntake, {
      params: { id: profileId },
      body: { companyMail: "privacy_only" },
    });
    expect(shown).toMatchObject({ ok: true, body: { intakeNotice: { removed: 111 } } });

    const dismissed = await ctx.call(API_ROUTES.mailboxNoticeDismiss, {
      params: { id: profileId },
    });
    expect(dismissed).toMatchObject({ ok: true, body: { intakeNotice: null } });
    expect(row()?.intakeNoticeSeenAt).not.toBeNull();
  });

  it("is not shown when the cleanup removed nothing or has not run yet", async () => {
    ctx.services.db
      .update(mailboxes)
      .set({ intakeCleanup: "pending", intakeCleanupRemoved: 5 })
      .where(eq(mailboxes.id, mailboxId))
      .run();
    const pending = await ctx.call(API_ROUTES.mailboxIntake, {
      params: { id: profileId },
      body: { companyMail: "privacy_only" },
    });
    expect(pending).toMatchObject({ ok: true, body: { intakeNotice: null } });
  });
});

describe("the reply address", () => {
  const mailbox = () => ctx.mail.mailbox("jordan@example.com");

  it("counts only after a test mail sent to it is found in the mailbox", async () => {
    const result = await ctx.call(API_ROUTES.mailboxAliasEnable, { params: { id: profileId } });
    expect(result).toMatchObject({
      ok: true,
      body: {
        verified: true,
        problem: null,
        mailbox: { replyAlias: "jordan+kickrocks@example.com", replyAliasVerified: true },
      },
    });
    expect(ctx.mail.sent.at(-1)?.mail).toMatchObject({
      to: "jordan+kickrocks@example.com",
      from: { address: "jordan@example.com" },
    });
    expect(row()?.replyAliasVerifiedAt).not.toBeNull();
  });

  it("stays unverified when the provider drops the tag", async () => {
    mailbox().acceptsPlusAddresses = false;
    const result = await enableReplyAlias(ctx.services, row() as never, {
      attempts: 2,
      delayMs: 0,
    });
    expect(result.verified).toBe(false);
    expect(result.problem).toMatch(/did not arrive/);
    expect(result.mailbox).toMatchObject({
      replyAlias: "jordan+kickrocks@example.com",
      replyAliasVerified: false,
    });
    expect(row()?.replyAliasVerifiedAt).toBeNull();
  });

  it("stays unverified when the server cannot search for the test mail", async () => {
    mailbox().searchSupported = false;
    const result = await enableReplyAlias(ctx.services, row() as never, {
      attempts: 1,
      delayMs: 0,
    });
    expect(result).toMatchObject({ verified: false });
    expect(result.problem).toMatch(/could not search/);
  });

  it("is refused for a provider that does not plus-address", async () => {
    ctx.services.db
      .update(mailboxes)
      .set({ provider: "yahoo" })
      .where(eq(mailboxes.id, mailboxId))
      .run();
    const result = await ctx.call(API_ROUTES.mailboxAliasEnable, { params: { id: profileId } });
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it("can be turned off, which forgets the proof", async () => {
    await ctx.call(API_ROUTES.mailboxAliasEnable, { params: { id: profileId } });
    const off = await ctx.call(API_ROUTES.mailboxAliasDisable, { params: { id: profileId } });
    expect(off).toMatchObject({
      ok: true,
      body: { replyAlias: null, replyAliasVerified: false },
    });
  });

  it("is forgotten when the mailbox address changes", async () => {
    await ctx.call(API_ROUTES.mailboxAliasEnable, { params: { id: profileId } });
    const saved = await ctx.call(API_ROUTES.mailboxSave, {
      params: { id: profileId },
      body: {
        provider: "fastmail",
        address: "other@example.com",
        username: "other@example.com",
        smtpHost: "smtp.example.test",
        smtpPort: 465,
        smtpSecure: true,
        imapHost: "imap.example.test",
        imapPort: 993,
        replyFolder: "INBOX",
        dailyCap: 100,
        password: "new-app-password",
      },
    });
    expect(saved).toMatchObject({
      ok: true,
      body: { replyAlias: null, replyAliasVerified: false },
    });
  });
});

describe("senders to always take in", () => {
  it("adds, lists and removes a domain and an address for a target", async () => {
    const target = seedTarget(ctx, { id: "spokeo", domain: "spokeo.test" });
    const added = await ctx.call(API_ROUTES.intakeSenderAdd, {
      params: { id: profileId },
      body: { targetId: target.id, value: "Reports.Example.org" },
    });
    expect(added).toMatchObject({
      ok: true,
      body: { kind: "domain", value: "reports.example.org", targetId: "spokeo" },
    });
    await ctx.call(API_ROUTES.intakeSenderAdd, {
      params: { id: profileId },
      body: { targetId: target.id, value: "help@partner.test" },
    });

    const listed = await ctx.call(API_ROUTES.intakeSendersList, { params: { id: profileId } });
    expect(listed).toMatchObject({ ok: true });
    if (!listed.ok) return;
    expect(listed.body.senders.map((sender) => [sender.kind, sender.value])).toEqual(
      expect.arrayContaining([
        ["domain", "reports.example.org"],
        ["address", "help@partner.test"],
      ]),
    );

    const first = listed.body.senders[0];
    const removed = await ctx.call(API_ROUTES.intakeSenderRemove, {
      params: { id: profileId, senderId: first?.id as string },
    });
    expect(removed).toMatchObject({ ok: true });
    expect(ctx.services.db.select().from(intakeSenders).all()).toHaveLength(1);
  });

  it("refuses something that is neither a domain nor an address, and an unknown target", async () => {
    const target = seedTarget(ctx, { id: "spokeo", domain: "spokeo.test" });
    const bad = await ctx.call(API_ROUTES.intakeSenderAdd, {
      params: { id: profileId },
      body: { targetId: target.id, value: "not a domain" },
    });
    expect(bad).toMatchObject({ ok: false, status: 400 });
    const unknown = await ctx.call(API_ROUTES.intakeSenderAdd, {
      params: { id: profileId },
      body: { targetId: "nobody", value: "example.org" },
    });
    expect(unknown).toMatchObject({ ok: false, status: 404 });
  });

  it("does not add the same sender twice", async () => {
    const target = seedTarget(ctx, { id: "spokeo", domain: "spokeo.test" });
    for (let i = 0; i < 2; i += 1) {
      await ctx.call(API_ROUTES.intakeSenderAdd, {
        params: { id: profileId },
        body: { targetId: target.id, value: "example.org" },
      });
    }
    expect(ctx.services.db.select().from(intakeSenders).all()).toHaveLength(1);
  });
});

describe("finding a missing reply", () => {
  async function deliverReplies() {
    seedTarget(ctx, { id: "spokeo", domain: "spokeo.test" });
    const box = ctx.mail.mailbox("jordan@example.com");
    box.deliver({
      subject: "Your photos",
      from: { name: null, address: "friend@partner.test" },
      text: "Spokeo showed my old listing",
    });
    box.deliver({
      subject: "Newsletter",
      from: { name: null, address: "news@partner.test" },
      headers: { "list-unsubscribe": "<mailto:u@partner.test>" },
    });
    return box;
  }

  const day = (offset: number) =>
    new Date(ctx.clock.now().getTime() + offset * 86_400_000).toISOString().slice(0, 10);

  it("lists what a sender search finds with each message's rule, and stores nothing", async () => {
    await deliverReplies();
    const result = await ctx.call(API_ROUTES.mailboxFind, {
      params: { id: profileId },
      body: { query: "partner.test", from: day(-2), to: day(1) },
    });
    expect(result).toMatchObject({ ok: true, body: { searched: true } });
    if (!result.ok) return;
    expect(result.body.messages.map((m) => [m.subject, m.admittedBy, m.stored])).toEqual([
      ["Newsletter", null, false],
      ["Your photos", null, false],
    ]);
    expect(ctx.services.db.select().from(messages).all()).toHaveLength(0);
  });

  it("finds a message by one of our references", async () => {
    await deliverReplies();
    ctx.mail
      .mailbox("jordan@example.com")
      .deliver({ subject: "Case KR-7K3M9Q", from: { name: null, address: "x@y.test" } });
    const result = await ctx.call(API_ROUTES.mailboxFind, {
      params: { id: profileId },
      body: { query: "KR-7K3M9Q", from: day(-2), to: day(1) },
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.body.messages).toHaveLength(1);
  });

  it("says so when the server cannot search", async () => {
    const box = await deliverReplies();
    box.searchSupported = false;
    const result = await ctx.call(API_ROUTES.mailboxFind, {
      params: { id: profileId },
      body: { query: "partner.test", from: day(-2), to: day(1) },
    });
    expect(result).toMatchObject({ ok: true, body: { searched: false, messages: [] } });
  });

  it("takes a chosen message in as the person's own choice", async () => {
    await deliverReplies();
    const found = await ctx.call(API_ROUTES.mailboxFind, {
      params: { id: profileId },
      body: { query: "friend@partner.test", from: day(-2), to: day(1) },
    });
    if (!found.ok) throw new Error("search failed");
    const [hit] = found.body.messages;
    const taken = await ctx.call(API_ROUTES.mailboxTakeIn, {
      params: { id: profileId },
      body: { uid: hit?.uid as number, uidValidity: hit?.uidValidity as number },
    });
    expect(taken).toMatchObject({
      ok: true,
      body: { subject: "Your photos", admittedBy: "person", reviewed: false },
    });
    expect(ctx.services.db.select().from(messages).all()).toHaveLength(1);

    const again = await ctx.call(API_ROUTES.mailboxFind, {
      params: { id: profileId },
      body: { query: "friend@partner.test", from: day(-2), to: day(1) },
    });
    expect(again).toMatchObject({ ok: true, body: { messages: [{ stored: true }] } });
  });

  it("refuses a message when the folder was renumbered since the search", async () => {
    await deliverReplies();
    const result = await ctx.call(API_ROUTES.mailboxTakeIn, {
      params: { id: profileId },
      body: { uid: 1, uidValidity: 999 },
    });
    expect(result).toMatchObject({ ok: false, status: 409 });
  });
});
