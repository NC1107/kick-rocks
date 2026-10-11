import { intakeShadow, mailboxes, messages } from "@kickrocks/db";
import { API_ROUTES, SHADOW_DAYS } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReplyClassifier } from "../mail/classifier.js";
import type { InboxMessage } from "../mail/types.js";
import {
  createTestContext,
  MINUTE,
  seedMailbox,
  seedProfile,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { createRunners, type Runners } from "./index.js";
import { purgeExpiredIntake } from "./intake-cleanup.js";
import { readShadow } from "./intake-shadow.js";

const ADDRESS = "jordan@example.com";
const DAY = 24 * 60 * MINUTE;
const BULK = { "list-unsubscribe": "<mailto:unsubscribe@news.test>" };

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
  mailboxId = seedMailbox(ctx, profileId, { address: ADDRESS }).id;
  runners = createRunners(ctx.services, { random: () => 0 });
});

afterEach(async () => {
  await ctx.close();
});

const box = () => ctx.mail.mailbox(ADDRESS);
const deliver = (overrides: Partial<InboxMessage>) =>
  box().deliver({ to: [ADDRESS], text: "", ...overrides });
const from = (address: string) => ({ name: null, address });
function mailboxRow() {
  return ctx.services.db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.id, mailboxId))
    .get() as typeof mailboxes.$inferSelect;
}
const lines = () => readShadow(ctx.services, mailboxRow()).items;

const SPOKEO = { kind: "broker", id: "spokeo", name: "Spokeo", domain: "spokeo.test" } as const;
const AMAZON = {
  kind: "company",
  id: "amazon",
  name: "Amazon",
  domain: "amazon.test",
  privacyEmail: "privacy@amazon.test",
} as const;

async function sentRequest(target: Parameters<typeof seedTarget>[1]) {
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
  await runners.inbox.runDue();
  return ctx.services.requests.getOrThrow(request.id);
}

function openShadowWindow(): void {
  ctx.services.db
    .update(mailboxes)
    .set({
      intakeShadowUntil: new Date(ctx.clock.now().getTime() + SHADOW_DAYS * DAY).toISOString(),
    })
    .where(eq(mailboxes.id, mailboxId))
    .run();
}

async function poll() {
  ctx.services.dispatch.enqueueInboxPoll(mailboxId);
  await runners.inbox.runDue();
}

const stored = () =>
  ctx.services.db.select().from(messages).where(eq(messages.mailboxId, mailboxId)).all();

describe("the report of mail the new rules passed over", () => {
  it("lists passed-over mail that ties to a request, with the rule that passed it over", async () => {
    await sentRequest(SPOKEO);
    await sentRequest(AMAZON);
    openShadowWindow();
    const sale = deliver({
      subject: "Spokeo sale",
      from: from("deals@spokeo.test"),
      headers: BULK,
      text: "Search anyone for less.",
    });
    deliver({
      subject: "Your order has shipped",
      from: from("orders@amazon.test"),
      text: "Track your package.",
    });
    deliver({
      subject: "Please delete your data",
      from: from("someone@elsewhere.test"),
      text: "Hello",
    });
    deliver({ subject: "Weekly digest", from: from("news@letters.test"), headers: BULK });
    deliver({ subject: "Lunch on friday?", from: from("friend@elsewhere.test") });

    await poll();

    expect(stored()).toEqual([]);
    expect(
      lines()
        .map(({ fromAddress, subject, rule }) => ({ fromAddress, subject, rule }))
        .sort((a, b) => a.subject.localeCompare(b.subject)),
    ).toEqual([
      {
        fromAddress: "someone@elsewhere.test",
        subject: "Please delete your data",
        rule: "not_named",
      },
      { fromAddress: "deals@spokeo.test", subject: "Spokeo sale", rule: "bulk_no_privacy" },
      {
        fromAddress: "orders@amazon.test",
        subject: "Your order has shipped",
        rule: "company_not_privacy",
      },
    ]);
    const line = lines().find((entry) => entry.subject === "Spokeo sale");
    expect(line?.receivedAt).toBe(sale.date?.toISOString());
  });

  it("lists bulk mail from a stranger whose body, not subject, names a target", async () => {
    await sentRequest(SPOKEO);
    openShadowWindow();
    deliver({
      subject: "Your request has been completed",
      from: from("no-reply@vendor.test"),
      headers: BULK,
      text: "Spokeo has deleted your personal data.",
    });
    deliver({
      subject: "Your request has been completed",
      from: from("no-reply@other.test"),
      headers: BULK,
      text: "Thanks for shopping with us.",
    });

    await poll();

    expect(stored()).toEqual([]);
    expect(lines().map((line) => line.fromAddress)).toEqual(["no-reply@vendor.test"]);
  });

  it("names a finished request as the reason when its sender is passed over", async () => {
    const spokeo = await sentRequest(SPOKEO);
    ctx.services.requests.transition(spokeo.id, "confirmed", { actor: "system" });
    openShadowWindow();
    deliver({ subject: "Hello again", from: from("help@spokeo.test"), text: "Hi" });

    await poll();

    expect(lines().map((line) => line.rule)).toEqual(["finished_request"]);
  });

  it("lists nothing when no week was started, which is the case for a mailbox made after the upgrade", async () => {
    await sentRequest(SPOKEO);
    deliver({ subject: "Spokeo sale", from: from("deals@spokeo.test"), headers: BULK });

    await poll();

    expect(ctx.services.db.select().from(intakeShadow).all()).toEqual([]);
    expect(readShadow(ctx.services, mailboxRow())).toMatchObject({ active: false, items: [] });
  });

  it("does not list the same message twice", async () => {
    const spokeo = await sentRequest(SPOKEO);
    openShadowWindow();
    deliver({ subject: "Spokeo sale", from: from("deals@spokeo.test"), headers: BULK });

    await poll();
    ctx.services.dispatch.enqueueInboxPoll(mailboxId, {
      rescan: {
        since: new Date(ctx.clock.now().getTime() - DAY).toISOString(),
        targetId: spokeo.targetId,
      },
    });
    await runners.inbox.runDue();

    expect(lines()).toHaveLength(1);
  });

  it("stops after the week", async () => {
    await sentRequest(SPOKEO);
    openShadowWindow();
    deliver({ subject: "Spokeo sale", from: from("deals@spokeo.test"), headers: BULK });
    await poll();
    ctx.clock.advance((SHADOW_DAYS * 24 * 60 + 1) * MINUTE);
    deliver({ subject: "Spokeo sale again", from: from("deals@spokeo.test"), headers: BULK });

    await poll();

    expect(readShadow(ctx.services, mailboxRow())).toMatchObject({ active: false, items: [] });
    expect(ctx.services.db.select().from(intakeShadow).all()).toHaveLength(1);
    expect(purgeExpiredIntake(ctx.services)).toBe(1);
    expect(ctx.services.db.select().from(intakeShadow).all()).toEqual([]);
  });

  it("is closed for good when the person dismisses it", async () => {
    await sentRequest(SPOKEO);
    openShadowWindow();
    deliver({ subject: "Spokeo sale", from: from("deals@spokeo.test"), headers: BULK });
    await poll();
    expect(lines()).toHaveLength(1);

    const dismissed = await ctx.call(API_ROUTES.intakeShadowDismiss, { params: { id: profileId } });
    expect(dismissed).toMatchObject({ ok: true });

    deliver({ subject: "Spokeo sale again", from: from("deals@spokeo.test"), headers: BULK });
    await poll();
    expect(ctx.services.db.select().from(intakeShadow).all()).toEqual([]);
    const read = await ctx.call(API_ROUTES.intakeShadow, { params: { id: profileId } });
    expect(read).toMatchObject({ ok: true, body: { active: false, items: [] } });
  });

  it("takes a listed message in from the mailbox and removes it from the list", async () => {
    await sentRequest(SPOKEO);
    openShadowWindow();
    deliver({
      subject: "Spokeo sale",
      from: from("deals@spokeo.test"),
      headers: BULK,
      text: "Search anyone for less.",
    });
    await poll();
    const [line] = lines();

    const taken = await ctx.call(API_ROUTES.intakeShadowTakeIn, {
      params: { id: profileId, shadowId: line?.id as string },
    });

    expect(taken).toMatchObject({
      ok: true,
      body: { subject: "Spokeo sale", admittedBy: "person", reviewed: expect.any(Boolean) },
    });
    expect(stored().map((row) => row.subject)).toEqual(["Spokeo sale"]);
    expect(lines()).toEqual([]);
  });

  it("drops a listed message that is no longer in the mailbox when it cannot be taken in", async () => {
    await sentRequest(SPOKEO);
    openShadowWindow();
    deliver({ subject: "Spokeo sale", from: from("deals@spokeo.test"), headers: BULK });
    await poll();
    const [line] = lines();
    // The folder was renumbered since, so the message cannot be found again by its number.
    ctx.services.db.update(intakeShadow).set({ uidValidity: 99 }).run();

    const taken = await ctx.call(API_ROUTES.intakeShadowTakeIn, {
      params: { id: profileId, shadowId: line?.id as string },
    });

    expect(taken).toMatchObject({ ok: false, status: 409 });
    expect(lines()).toEqual([]);
  });
});

describe("mail to the reply address that names no open request", () => {
  const ALIAS = "jordan+kickrocks@example.com";
  const done = "Your privacy request has been completed and your information has been removed.";

  beforeEach(() => {
    ctx.services.db
      .update(mailboxes)
      .set({ replyAlias: ALIAS, replyAliasVerifiedAt: ctx.clock.now().toISOString() })
      .where(eq(mailboxes.id, mailboxId))
      .run();
  });

  it("is not taken in, and is listed so the person can take it in", async () => {
    await sentRequest(SPOKEO);
    openShadowWindow();
    deliver({
      subject: "Your privacy request",
      to: [ALIAS],
      from: from("team@privacyops.example"),
      text: done,
    });

    await poll();

    expect(stored()).toEqual([]);
    expect(lines().map(({ subject, rule }) => ({ subject, rule }))).toEqual([
      { subject: "Your privacy request", rule: "not_named" },
    ]);
  });

  it("is taken in when its signature names the company", async () => {
    await sentRequest(SPOKEO);
    openShadowWindow();
    deliver({
      subject: "Your privacy request",
      to: [ALIAS],
      from: from("team@privacyops.example"),
      text: `${done}\n\nSpokeo Privacy Team`,
    });

    await poll();

    expect(stored()).toHaveLength(1);
    expect(lines()).toEqual([]);
  });
});
