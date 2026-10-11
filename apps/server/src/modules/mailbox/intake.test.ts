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

describe("the list of stored mail to remove", () => {
  function storeNoise(subject: string, id = crypto.randomUUID()) {
    ctx.services.db
      .insert(messages)
      .values({
        id,
        mailboxId,
        imapUid: Math.floor(Math.random() * 1_000_000),
        uidValidity: 1,
        fromAddress: "news@letters.test",
        subject,
        receivedAt: ctx.clock.now().toISOString(),
        classification: "unrelated",
        confidence: 0.8,
        links: [],
        reviewed: true,
        cleanupCandidate: true,
        createdAt: ctx.clock.now().toISOString(),
      })
      .run();
    return id;
  }
  const setState = (intakeCleanup: "pending" | "review" | "done") =>
    ctx.services.db
      .update(mailboxes)
      .set({ intakeCleanup })
      .where(eq(mailboxes.id, mailboxId))
      .run();

  it("shows what a confirmation would remove and removes nothing by showing it", async () => {
    setState("review");
    storeNoise("Summer sale");

    const shown = await ctx.call(API_ROUTES.intakeCleanup, { params: { id: profileId } });

    expect(shown).toMatchObject({
      ok: true,
      body: {
        state: "review",
        items: [{ fromAddress: "news@letters.test", subject: "Summer sale" }],
      },
    });
    expect(ctx.services.db.select().from(messages).all()).toHaveLength(1);
  });

  it("shows no list before the first check has made one, and none after the decision", async () => {
    storeNoise("Summer sale");
    for (const state of ["pending", "done"] as const) {
      setState(state);
      const shown = await ctx.call(API_ROUTES.intakeCleanup, { params: { id: profileId } });
      expect(shown).toMatchObject({ ok: true, body: { state, items: [] } });
    }
  });

  it("moves the listed mail to the ignored list when confirmed, and the person can take it back", async () => {
    setState("review");
    const id = storeNoise("Summer sale");

    const confirmed = await ctx.call(API_ROUTES.intakeCleanupConfirm, {
      params: { id: profileId },
    });
    expect(confirmed).toMatchObject({ ok: true, body: { removed: 1 } });
    expect(ctx.services.db.select().from(messages).all()).toEqual([]);
    const ignored = await ctx.call(API_ROUTES.intakeIgnored, { params: { id: profileId } });
    expect(ignored).toMatchObject({ ok: true, body: { items: [{ id, subject: "Summer sale" }] } });

    const taken = await ctx.call(API_ROUTES.intakeIgnoredTakeIn, {
      params: { id: profileId, messageId: id },
    });
    expect(taken).toMatchObject({
      ok: true,
      body: { id, subject: "Summer sale", reviewed: false, admittedBy: "person" },
    });
    const after = await ctx.call(API_ROUTES.intakeIgnored, { params: { id: profileId } });
    expect(after).toMatchObject({ ok: true, body: { items: [] } });
  });

  it("refuses to confirm when no list is waiting", async () => {
    setState("done");
    const refused = await ctx.call(API_ROUTES.intakeCleanupConfirm, { params: { id: profileId } });
    expect(refused).toMatchObject({ ok: false, status: 409 });
  });

  it("keeps everything when the person says so", async () => {
    setState("review");
    storeNoise("Summer sale");

    const kept = await ctx.call(API_ROUTES.intakeCleanupKeep, { params: { id: profileId } });

    expect(kept).toMatchObject({ ok: true });
    expect(ctx.services.db.select().from(messages).all()).toHaveLength(1);
    expect(row()).toMatchObject({ intakeCleanup: "done", intakeCleanupRemoved: 0 });
  });

  it("does not take back a message that is not in the list", async () => {
    const missing = await ctx.call(API_ROUTES.intakeIgnoredTakeIn, {
      params: { id: profileId, messageId: "nothing" },
    });
    expect(missing).toMatchObject({ ok: false, status: 404 });
  });
});

describe("the reply address", () => {
  const mailbox = () => ctx.mail.mailbox("jordan@example.com");
  const NEUTRAL_ALIAS = /^jordan\+p[0-9a-f]{6}@example\.com$/;

  it("never carries the name of the tool, and stays the same when turned on again", async () => {
    await enableReplyAlias(ctx.services, row() as never, { attempts: 1, delayMs: 0 });
    const first = row()?.replyAlias;
    expect(first).not.toMatch(/kick|rocks/i);
    await enableReplyAlias(ctx.services, row() as never, { attempts: 1, delayMs: 0 });
    expect(row()?.replyAlias).toBe(first);
  });

  it("counts only after a test mail sent to it is found in the mailbox", async () => {
    const result = await ctx.call(API_ROUTES.mailboxAliasEnable, { params: { id: profileId } });
    expect(result).toMatchObject({
      ok: true,
      body: {
        verified: true,
        problem: null,
        mailbox: { replyAlias: expect.stringMatching(NEUTRAL_ALIAS), replyAliasVerified: true },
      },
    });
    expect(ctx.mail.sent.at(-1)?.mail).toMatchObject({
      to: row()?.replyAlias,
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
      replyAlias: expect.stringMatching(NEUTRAL_ALIAS),
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
