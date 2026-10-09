import { type MailboxRow, mailboxes, messages, requestEvents } from "@kickrocks/db";
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
import { createRunners, type Runners } from "./index.js";

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
    classification?: "auto_ack" | "unrelated" | "completed" | "unknown";
    text?: string;
    uid?: number;
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
      reviewed: false,
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

describe("the one-time cleanup of stored mail", () => {
  it("removes marketing attached as an acknowledgement, together with its timeline entries", async () => {
    const amazon = await openRequest(AMAZON);
    const marketing = legacy(
      { subject: "Deals just for you", from: from("deals@amazon.test"), headers: BULK },
      { requestId: amazon.id, classification: "auto_ack" },
    );
    const order = legacy(
      { subject: "Your order", from: from("orders@amazon.test") },
      { requestId: amazon.id, classification: "auto_ack" },
    );
    const bank = legacy({ subject: "Security alert", from: from("alerts@bank.test") });

    await poll();

    expect(rows()).toHaveLength(0);
    for (const id of [marketing, order, bank]) expect(eventsAbout(id)).toEqual([]);
    expect(mailboxRow()).toMatchObject({ intakeCleanup: "done", intakeCleanupRemoved: 3 });
    expect(mailboxRow().intakeCleanupAt).not.toBeNull();
  });

  it("keeps what the person acted on and what changed a request", async () => {
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

    expect(
      rows()
        .map((row) => row.id)
        .sort(),
    ).toEqual([acted, decided].sort());
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
    const fromTarget = legacy({
      uid: 901,
      subject: "Deals",
      from: from("deals@spokeo.test"),
      text: "Search anyone",
    });
    const namesTarget = legacy({
      uid: 902,
      subject: "Fwd",
      from: from("friend@elsewhere.test"),
      text: "Look at what Spokeo has on me",
    });
    const bound = legacy({
      uid: 903,
      subject: `Re: ${spokeo.reference}`,
      from: from("x@y.test"),
    });

    await poll();

    expect(
      rows()
        .map((row) => row.id)
        .sort(),
    ).toEqual([fromTarget, namesTarget, bound].sort());
    expect(rows().find((row) => row.id === stranger)).toBeUndefined();
    expect(rows().find((row) => row.id === bound)?.admittedBy).toBe("reference");
  });

  it("does nothing the second time", async () => {
    await openRequest(SPOKEO);
    legacy({ subject: "Sale", from: from("news@letters.test"), headers: BULK });
    await poll();
    expect(mailboxRow().intakeCleanupRemoved).toBe(1);

    legacy({ subject: "Another sale", from: from("news@letters.test"), headers: BULK });
    await poll();
    expect(mailboxRow().intakeCleanupRemoved).toBe(1);
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
