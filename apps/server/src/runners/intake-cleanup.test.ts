import {
  ignoredMessages,
  type MailboxRow,
  mailboxes,
  messages,
  requestEvents,
} from "@kickrocks/db";
import { IGNORED_KEEP_DAYS, outgoingMessageId } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InboxMessage, InboxSession } from "../mail/types.js";
import {
  createTestContext,
  MINUTE,
  seedMailbox,
  seedProfile,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { InboxRunner } from "./inbox-poll.js";
import { createRunners, type Runners } from "./index.js";
import {
  confirmCleanup,
  keepStoredMail,
  listIgnored,
  previewCleanup,
  purgeExpiredIntake,
  takeInIgnored,
} from "./intake-cleanup.js";

const ADDRESS = "jordan@example.com";

let ctx: TestContext;
let profileId: string;
let mailboxId: string;
let runners: Runners;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  mailboxId = seedMailbox(ctx, profileId, { address: ADDRESS, intakeCleanup: "pending" }).id;
  runners = createRunners(ctx.services, { random: () => 0 });
});

afterEach(async () => {
  await ctx.close();
});

const box = () => ctx.mail.mailbox(ADDRESS);
const from = (address: string) => ({ name: null, address });
const BULK = { "list-unsubscribe": "<mailto:unsubscribe@news.test>" };

async function openRequest(target: Parameters<typeof seedTarget>[1]) {
  const seeded = seedTarget(ctx, target);
  const { request } = ctx.services.requests.open({
    profileId,
    targetId: seeded.id,
    rights: ["opt_out"],
    channel: "email",
    actor: "user",
  });
  await runners.email.runDue();
  ctx.clock.advance(MINUTE);
  // The rescan a first send asks for would run the cleanup before any stored mail is there.
  await runners.inbox.runDue();
  ctx.services.db.update(mailboxes).set({ intakeCleanup: "pending" }).run();
  return ctx.services.requests.getOrThrow(request.id);
}

/** A message the way the app stored it before the intake gate, with its copy on the server. */
function legacy(
  delivered: Partial<InboxMessage>,
  stored: {
    requestId?: string | null;
    classification?: "auto_ack" | "unrelated" | "completed" | "unknown" | "bounce";
    text?: string;
    uid?: number;
    reviewed?: boolean;
  } = {},
) {
  const message =
    delivered.uid === undefined && stored.uid === undefined
      ? box().deliver({ to: [ADDRESS], ...delivered })
      : null;
  const id = crypto.randomUUID();
  ctx.services.db
    .insert(messages)
    .values({
      id,
      mailboxId,
      imapUid: stored.uid ?? message?.uid ?? (delivered.uid as number),
      uidValidity: 1,
      requestId: stored.requestId ?? null,
      messageIdHeader: message?.messageId ?? delivered.messageId ?? null,
      inReplyTo: delivered.inReplyTo ?? null,
      fromAddress: delivered.from?.address ?? "",
      subject: delivered.subject ?? "",
      receivedAt: ctx.clock.now().toISOString(),
      classification: stored.classification ?? "unrelated",
      confidence: 0.7,
      rationale: null,
      links: [],
      requestedFields: [],
      snippet: null,
      text: stored.text ?? delivered.text ?? "",
      reviewed:
        stored.reviewed ?? ["unrelated", "auto_ack"].includes(stored.classification ?? "unrelated"),
      createdAt: ctx.clock.now().toISOString(),
    })
    .run();
  if (stored.requestId) {
    ctx.services.requests.addEvent(stored.requestId, {
      type: "reply_received",
      actor: "system",
      payload: {
        messageId: id,
        from: delivered.from?.address ?? "",
        subject: delivered.subject ?? "",
      },
    });
    ctx.services.requests.addEvent(stored.requestId, {
      type: "classified",
      actor: "system",
      payload: {
        messageId: id,
        classification: stored.classification ?? "unrelated",
        confidence: 0.7,
        correlation: "sender_domain",
      },
    });
  }
  return id;
}

const SPOKEO = { kind: "broker", id: "spokeo", name: "Spokeo", domain: "spokeo.test" } as const;
const AMAZON = {
  kind: "company",
  id: "amazon",
  name: "Amazon",
  domain: "amazon.test",
  privacyEmail: "privacy@amazon.test",
} as const;

const rows = () =>
  ctx.services.db.select().from(messages).where(eq(messages.mailboxId, mailboxId)).all();
const mailboxRow = (): MailboxRow =>
  ctx.services.db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get() as MailboxRow;
const eventsAbout = (id: string) =>
  ctx.services.db
    .select()
    .from(requestEvents)
    .all()
    .filter((event) => (event.payload as { messageId?: string }).messageId === id);

async function poll() {
  ctx.services.dispatch.enqueueInboxPoll(mailboxId);
  await runners.inbox.runDue();
}

const intake = () => new InboxRunner(ctx.services).intake(mailboxRow());
const preview = () => previewCleanup(ctx.services, mailboxRow(), intake());
const confirm = () => confirmCleanup(ctx.services, mailboxRow(), intake());
const ignored = () => listIgnored(ctx.services, mailboxRow()).items;
const subjects = (lines: Array<{ subject: string }>) => lines.map((line) => line.subject).sort();
const ids = (list: Array<{ id: string }>) => list.map((row) => row.id).sort();

describe("the one-time cleanup of stored mail", () => {
  it("lists what it would remove and removes nothing until the person confirms", async () => {
    await openRequest(AMAZON);
    const sale = legacy({ subject: "Summer sale", from: from("news@letters.test"), headers: BULK });
    const bank = legacy({ subject: "Security alert", from: from("alerts@bank.test") });
    const eventsBefore = ctx.services.db.select().from(requestEvents).all().length;

    await poll();

    expect(mailboxRow().intakeCleanup).toBe("review");
    expect(rows()).toHaveLength(2);
    expect(ctx.services.db.select().from(requestEvents).all()).toHaveLength(eventsBefore);
    expect(ignored()).toEqual([]);
    expect(preview()).toMatchObject({ state: "review", removed: null });
    expect(subjects(preview().items)).toEqual(["Security alert", "Summer sale"]);
    expect(
      preview()
        .items.map((item) => item.fromAddress)
        .sort(),
    ).toEqual(["alerts@bank.test", "news@letters.test"]);

    expect(confirm()).toBe(2);

    expect(rows()).toHaveLength(0);
    for (const id of [sale, bank]) expect(eventsAbout(id)).toEqual([]);
    expect(mailboxRow()).toMatchObject({ intakeCleanup: "done", intakeCleanupRemoved: 2 });
    expect(mailboxRow().intakeCleanupAt).not.toBeNull();
    expect(subjects(ignored())).toEqual(["Security alert", "Summer sale"]);
  });

  it("keeps the list across polls and asks again only when the person has not answered", async () => {
    await openRequest(SPOKEO);
    legacy({ subject: "Sale", from: from("news@letters.test"), headers: BULK });
    await poll();
    await poll();

    expect(mailboxRow().intakeCleanup).toBe("review");
    expect(preview().items).toHaveLength(1);
    expect(rows()).toHaveLength(1);
  });

  it("never lists mail a request holds, even when it looks like marketing", async () => {
    const amazon = await openRequest(AMAZON);
    const marketing = legacy(
      { subject: "Deals just for you", from: from("deals@amazon.test"), headers: BULK },
      { requestId: amazon.id, classification: "auto_ack" },
    );

    await poll();

    expect(preview().items).toEqual([]);
    expect(rows().map((row) => row.id)).toEqual([marketing]);
    expect(eventsAbout(marketing)).not.toEqual([]);
    expect(mailboxRow()).toMatchObject({ intakeCleanup: "done", intakeCleanupRemoved: 0 });
  });

  it("never lists an acknowledgement or an unreviewed reply bound to a request that has since closed", async () => {
    const spokeo = await openRequest(SPOKEO);
    const ack = legacy(
      { subject: "We got it", from: from("noreply@spokeo.test") },
      { requestId: spokeo.id, classification: "auto_ack" },
    );
    const waiting = legacy(
      { subject: "Re: your request", from: from("someone@elsewhere.test") },
      { requestId: spokeo.id, classification: "unknown" },
    );
    ctx.services.requests.transition(spokeo.id, "confirmed", { actor: "system" });

    await poll();

    expect(preview().items).toEqual([]);
    expect(ids(rows())).toEqual([ack, waiting].sort());
    expect(eventsAbout(ack)).not.toEqual([]);
    expect(eventsAbout(waiting)).not.toEqual([]);
  });

  it("never lists unbound mail that is unreviewed, or that is tied to a request even with the server copy", async () => {
    const spokeo = await openRequest(SPOKEO);
    const unreviewed = legacy(
      { subject: "Summer sale", from: from("news@letters.test"), headers: BULK },
      { reviewed: false },
    );
    const quoting = legacy({
      subject: "Fwd",
      from: from("friend@elsewhere.test"),
      text: `About ${spokeo.reference}`,
    });
    ctx.services.requests.transition(spokeo.id, "confirmed", { actor: "system" });
    const fromClosedTarget = legacy({
      subject: "Hello again",
      from: from("help@spokeo.test"),
      text: "Hi",
    });

    await poll();

    expect(preview().items).toEqual([]);
    expect(ids(rows())).toEqual([unreviewed, quoting, fromClosedTarget].sort());
  });

  it("never lists a bounce, or a message with one of our own ids", async () => {
    const spokeo = await openRequest(SPOKEO);
    const bounce = legacy(
      { subject: "Undeliverable", from: from("mailer-daemon@example.net") },
      { classification: "bounce", reviewed: true },
    );
    const ours = legacy({
      subject: "Copy of what we sent",
      from: from("jordan@example.com"),
      messageId: outgoingMessageId(spokeo.id, "example.com", 7),
    });
    const sale = legacy({ subject: "Summer sale", from: from("news@letters.test"), headers: BULK });

    await poll();

    expect(preview().items.map((item) => item.id)).toEqual([sale]);
    expect(confirm()).toBe(1);
    expect(ids(rows())).toEqual([bounce, ours].sort());
    expect(ignored().map((item) => item.id)).toEqual([sale]);
  });

  it("never lists what the person acted on or what changed a request", async () => {
    const spokeo = await openRequest(SPOKEO);
    const acted = legacy(
      { subject: "Deals", from: from("deals@spokeo.test"), headers: BULK },
      { requestId: spokeo.id, classification: "unknown" },
    );
    ctx.services.requests.addEvent(spokeo.id, {
      type: "classified",
      actor: "user",
      payload: {
        messageId: acted,
        classification: "auto_ack",
        confidence: 1,
        correlation: "manual",
      },
    });
    const decided = legacy(
      { subject: "Deals again", from: from("deals@spokeo.test"), headers: BULK },
      { requestId: spokeo.id, classification: "completed" },
    );

    await poll();

    expect(preview().items).toEqual([]);
    expect(ids(rows())).toEqual([acted, decided].sort());
    expect(mailboxRow()).toMatchObject({ intakeCleanup: "done", intakeCleanupRemoved: 0 });
  });

  it("keeps bound mail and records why it was taken in", async () => {
    const spokeo = await openRequest(SPOKEO);
    const reply = legacy(
      {
        subject: "Re: your request",
        from: from("support@spokeo.test"),
        inReplyTo: spokeo.outgoingMessageId as string,
      },
      { requestId: spokeo.id, classification: "auto_ack" },
    );
    const plain = legacy({ subject: "Update", from: from("help@spokeo.test") });

    await poll();

    const kept = Object.fromEntries(rows().map((row) => [row.id, row.admittedBy]));
    expect(kept).toEqual({ [reply]: "thread", [plain]: "target_sender" });
  });

  it("decides a message whose server copy is gone from what was stored", async () => {
    const spokeo = await openRequest(SPOKEO);
    const stranger = legacy({
      uid: 900,
      subject: "Summer sale",
      from: from("news@letters.test"),
      text: "Everything must go",
    });
    legacy({
      uid: 901,
      subject: "Deals",
      from: from("deals@spokeo.test"),
      text: "Search anyone",
    });
    legacy({
      uid: 902,
      subject: "Fwd",
      from: from("friend@elsewhere.test"),
      text: "Look at what Spokeo has on me",
    });
    legacy({ uid: 903, subject: `Re: ${spokeo.reference}`, from: from("x@y.test") });

    await poll();

    expect(preview().items.map((item) => item.id)).toEqual([stranger]);
    expect(rows().find((row) => row.subject.startsWith("Re: KR"))?.admittedBy).toBe("reference");
  });

  it("removes only what still qualifies when the person confirms", async () => {
    const spokeo = await openRequest(SPOKEO);
    const taken = legacy({ subject: "Offer", from: from("news@letters.test"), headers: BULK });
    const stays = legacy({
      subject: "Other offer",
      from: from("news@letters.test"),
      headers: BULK,
    });
    await poll();
    expect(preview().items).toHaveLength(2);

    ctx.services.db
      .update(messages)
      .set({ requestId: spokeo.id })
      .where(eq(messages.id, taken))
      .run();

    expect(preview().items.map((item) => item.id)).toEqual([stays]);
    expect(confirm()).toBe(1);
    expect(rows().map((row) => row.id)).toEqual([taken]);
    expect(rows()[0]?.cleanupCandidate).toBe(false);
  });

  it("changes nothing when the person keeps everything", async () => {
    await openRequest(SPOKEO);
    legacy({ subject: "Sale", from: from("news@letters.test"), headers: BULK });
    await poll();

    keepStoredMail(ctx.services, mailboxRow());

    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.cleanupCandidate).toBe(false);
    expect(ignored()).toEqual([]);
    expect(mailboxRow()).toMatchObject({ intakeCleanup: "done", intakeCleanupRemoved: 0 });
    expect(() => confirm()).toThrow(/no list/i);
  });

  it("refuses to confirm a list that was never made", async () => {
    await openRequest(SPOKEO);
    expect(() => confirm()).toThrow(/no list/i);
  });

  it("does nothing the second time", async () => {
    await openRequest(SPOKEO);
    legacy({ subject: "Sale", from: from("news@letters.test"), headers: BULK });
    await poll();
    confirm();
    expect(mailboxRow().intakeCleanupRemoved).toBe(1);

    legacy({ subject: "Another sale", from: from("news@letters.test"), headers: BULK });
    await poll();
    expect(mailboxRow()).toMatchObject({ intakeCleanup: "done", intakeCleanupRemoved: 1 });
    expect(rows().map((row) => row.subject)).toEqual(["Another sale"]);
  });

  it("does not ask the server about a mailbox that holds no stored mail", async () => {
    let headerCalls = 0;
    const inbox = ctx.mail.services.inbox;
    ctx.mail.services.inbox = (connection) => {
      const source = inbox(connection);
      return {
        ...source,
        withFolder: (folder, work) =>
          source.withFolder(folder, (session: InboxSession) =>
            work({
              ...session,
              headers: (uids) => {
                headerCalls += 1;
                return session.headers(uids);
              },
            }),
          ),
      };
    };
    await poll();
    expect(headerCalls).toBe(0);
    expect(mailboxRow()).toMatchObject({ intakeCleanup: "done", intakeCleanupRemoved: 0 });
  });
});

describe("the ignored list", () => {
  async function removeOne() {
    await openRequest(SPOKEO);
    const id = legacy({
      subject: "Summer sale",
      from: from("news@letters.test"),
      headers: BULK,
      text: "Everything must go",
    });
    await poll();
    confirm();
    return id;
  }

  it("keeps a removed message for 30 days with the day it goes", async () => {
    const id = await removeOne();
    const [item] = ignored();

    expect(item).toMatchObject({
      id,
      fromAddress: "news@letters.test",
      subject: "Summer sale",
    });
    expect(Date.parse(item?.keptUntil as string) - ctx.clock.now().getTime()).toBe(
      IGNORED_KEEP_DAYS * 24 * 60 * 60 * 1000,
    );
  });

  it("takes a message back as an unread item in Review", async () => {
    const id = await removeOne();

    const restored = takeInIgnored(ctx.services, mailboxRow(), id);

    expect(restored).toMatchObject({
      id,
      reviewed: false,
      requestId: null,
      admittedBy: "person",
      subject: "Summer sale",
      text: "Everything must go",
    });
    expect(ignored()).toEqual([]);
    expect(rows().map((row) => row.id)).toEqual([id]);
  });

  it("does not store a message twice when it was stored again meanwhile", async () => {
    const id = await removeOne();
    const copy = ctx.services.db.select().from(ignoredMessages).get();
    ctx.services.db
      .insert(messages)
      .values({
        id: crypto.randomUUID(),
        mailboxId,
        imapUid: copy?.imapUid as number,
        uidValidity: copy?.uidValidity as number,
        fromAddress: "news@letters.test",
        subject: "Summer sale",
        receivedAt: ctx.clock.now().toISOString(),
        classification: "unrelated",
        confidence: 0.5,
        links: [],
        createdAt: ctx.clock.now().toISOString(),
      })
      .run();

    expect(takeInIgnored(ctx.services, mailboxRow(), id).id).not.toBe(id);
    expect(rows()).toHaveLength(1);
    expect(ignored()).toEqual([]);
  });

  it("drops a message after 30 days and refuses to take it back", async () => {
    const id = await removeOne();
    ctx.clock.advance((IGNORED_KEEP_DAYS * 24 * 60 + 1) * MINUTE);

    expect(ignored()).toEqual([]);
    expect(() => takeInIgnored(ctx.services, mailboxRow(), id)).toThrow(/no longer kept/i);
    expect(purgeExpiredIntake(ctx.services)).toBe(1);
    expect(ctx.services.db.select().from(ignoredMessages).all()).toEqual([]);
  });

  it("purges only what is past its time", async () => {
    await removeOne();
    ctx.clock.advance((IGNORED_KEEP_DAYS * 24 * 60 - 5) * MINUTE);

    expect(purgeExpiredIntake(ctx.services)).toBe(0);
    expect(ignored()).toHaveLength(1);
  });
});
