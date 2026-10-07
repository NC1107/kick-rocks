import { NotificationSettings, parseOutgoingMessageId } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  DAY,
  HOUR,
  MINUTE,
  seedMailbox,
  seedMessage,
  seedProfile,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../../test-utils/index.js";
import {
  buildDigest,
  digestIsDue,
  latestDigestSlot,
  sendDigest,
  sendDigestIfDue,
} from "./digest.js";
import { readState, updateState } from "./state.js";

let ctx: TestContext;
let profileId: string;
let targetId: string;

beforeEach(async () => {
  ctx = await createTestContext({ now: "2026-10-07T12:00:00.000Z" });
  profileId = seedProfile(ctx, { displayName: "Jordan Example" }).id;
  targetId = seedTarget(ctx, { name: "Acme Data Brokers" }).id;
});

afterEach(async () => {
  await ctx.close();
});

function configureDigest(digest: Partial<NotificationSettings["digest"]> = {}): void {
  ctx.services.settings.set(
    "notifications",
    NotificationSettings.parse({ digest: { frequency: "daily", hourUtc: 8, ...digest } }),
  );
}

function moveRequest(
  requestId: string,
  ...path: Parameters<typeof ctx.services.requests.transition>[1][]
) {
  for (const status of path) {
    ctx.services.requests.transition(requestId, status, { actor: "system" });
  }
}

describe("latestDigestSlot", () => {
  const at = (iso: string) => new Date(iso);
  const daily = NotificationSettings.parse({ digest: { frequency: "daily", hourUtc: 8 } }).digest;
  const weekly = NotificationSettings.parse({
    digest: { frequency: "weekly", hourUtc: 8, weekday: 1 },
  }).digest;

  it("is never due when the digest is off", () => {
    expect(
      latestDigestSlot({ frequency: "off", hourUtc: 8, weekday: 1 }, at("2026-10-07T12:00:00Z")),
    ).toBeNull();
  });

  it("is today's hour once it has passed, and yesterday's before then", () => {
    expect(latestDigestSlot(daily, at("2026-10-07T12:00:00Z"))?.toISOString()).toBe(
      "2026-10-07T08:00:00.000Z",
    );
    expect(latestDigestSlot(daily, at("2026-10-07T07:59:00Z"))?.toISOString()).toBe(
      "2026-10-06T08:00:00.000Z",
    );
  });

  it("is the latest chosen weekday for a weekly digest", () => {
    // 2026-10-07 is a Wednesday, so the latest Monday is the 5th.
    expect(latestDigestSlot(weekly, at("2026-10-07T12:00:00Z"))?.toISOString()).toBe(
      "2026-10-05T08:00:00.000Z",
    );
    expect(latestDigestSlot(weekly, at("2026-10-05T07:00:00Z"))?.toISOString()).toBe(
      "2026-09-28T08:00:00.000Z",
    );
    expect(latestDigestSlot(weekly, at("2026-10-05T08:00:00Z"))?.toISOString()).toBe(
      "2026-10-05T08:00:00.000Z",
    );
  });
});

describe("when the digest is due", () => {
  it("is not due when off", () => {
    expect(digestIsDue(ctx.services)).toBe(false);
  });

  it("is due once a slot has passed since the last digest", () => {
    configureDigest();
    updateState(ctx.services, () => ({ digestLastSentAt: "2026-10-06T08:00:00.000Z" }));
    expect(digestIsDue(ctx.services)).toBe(true);
    updateState(ctx.services, () => ({ digestLastSentAt: "2026-10-07T08:00:01.000Z" }));
    expect(digestIsDue(ctx.services)).toBe(false);
    ctx.clock.advance(DAY);
    expect(digestIsDue(ctx.services)).toBe(true);
  });

  it("waits out the pause after a failed attempt", () => {
    configureDigest();
    updateState(ctx.services, () => ({
      digestLastSentAt: "2026-10-06T08:00:00.000Z",
      digestRetryAfter: "2026-10-07T12:10:00.000Z",
    }));
    expect(digestIsDue(ctx.services)).toBe(false);
    ctx.clock.advance(11 * MINUTE);
    expect(digestIsDue(ctx.services)).toBe(true);
  });
});

describe("the digest mail", () => {
  let mailboxId: string;
  const needsYou = () => seedMessage(ctx, { mailboxId });

  beforeEach(() => {
    mailboxId = seedMailbox(ctx, profileId, { address: "jordan@example.com" }).id;
    updateState(ctx.services, () => ({ digestLastSentAt: "2026-10-06T08:00:00.000Z" }));
  });

  it("goes from the person's mailbox to the same address, through the mailbox transport", async () => {
    const request = seedRequest(ctx, { profileId, targetId, status: "queued" });
    moveRequest(request.id, "sent", "awaiting_reply");

    const result = await sendDigest(ctx.services);

    expect(result).toEqual({ outcome: "sent", sent: 1, error: null });
    expect(ctx.mail.sent).toHaveLength(1);
    const [{ mail, connection }] = ctx.mail.sent as [(typeof ctx.mail.sent)[number]];
    expect(connection.address).toBe("jordan@example.com");
    expect(mail.from.address).toBe("jordan@example.com");
    expect(mail.to).toBe("jordan@example.com");
    expect(mail.subject).toBe("Kick Rocks digest: 1 status change, 0 things need you");
    expect(mail.text).toContain("Acme Data Brokers: queued -> awaiting reply");
    expect(mail.text).toContain("All requests");
  });

  it("uses a message id the inbox poll recognises as Kick Rocks' own mail", async () => {
    needsYou();
    await sendDigest(ctx.services);
    const id = ctx.mail.sent[0]?.mail.messageId ?? "";
    expect(parseOutgoingMessageId(id)).not.toBeNull();
    expect(id).toMatch(/@example\.com>$/);
  });

  it("lists what needs the person with counts and a link", async () => {
    needsYou();
    await sendDigest(ctx.services);
    const { mail } = ctx.mail.sent[0] as (typeof ctx.mail.sent)[number];
    expect(mail.subject).toBe("Kick Rocks digest: 0 status changes, 1 thing needs you");
    expect(mail.text).toContain("Needs you\n- Replies to review: 1");
    expect(mail.text).toContain("Open http://kickrocks.test/review");
  });

  it("shows a request's net move once, and nothing when it ended where it began", async () => {
    const moved = seedRequest(ctx, { profileId, targetId, status: "queued" });
    moveRequest(moved.id, "sent", "awaiting_reply", "confirmed");
    const target2 = seedTarget(ctx, { name: "Other Broker Co" });
    const same = seedRequest(ctx, { profileId, targetId: target2.id, status: "queued" });
    moveRequest(same.id, "sent");
    ctx.services.requests.transition(same.id, "queued", { actor: "system" });

    const content = buildDigest(
      ctx.services,
      { id: profileId, displayName: "Jordan Example" },
      new Date("2026-10-06T08:00:00.000Z"),
      ctx.clock.now(),
    );

    expect(content?.text).toContain("Acme Data Brokers: queued -> confirmed");
    expect(content?.text).not.toContain("Other Broker Co");
  });

  it("only covers changes since the last digest", async () => {
    const request = seedRequest(ctx, { profileId, targetId, status: "queued" });
    moveRequest(request.id, "sent");
    ctx.clock.advance(HOUR);
    await sendDigest(ctx.services);
    expect(ctx.mail.sent).toHaveLength(1);

    ctx.clock.advance(HOUR);
    moveRequest(request.id, "awaiting_reply");
    await sendDigest(ctx.services);
    const second = ctx.mail.sent[1]?.mail.text ?? "";
    expect(second).toContain("sent -> awaiting reply");
    expect(second).not.toContain("queued -> sent");
  });

  it("sends nothing when nothing changed and nothing waits, and still starts a new period", async () => {
    const result = await sendDigest(ctx.services);
    expect(result).toEqual({ outcome: "nothing_to_report", sent: 0, error: null });
    expect(ctx.mail.sent).toHaveLength(0);
    expect(readState(ctx.services).digestLastSentAt).toBe(ctx.clock.now().toISOString());
  });

  it("caps a long list of changes and points to the requests page", async () => {
    for (let index = 0; index < 45; index += 1) {
      const target = seedTarget(ctx, { name: `Broker ${index}` });
      const request = seedRequest(ctx, { profileId, targetId: target.id, status: "queued" });
      moveRequest(request.id, "sent");
    }
    await sendDigest(ctx.services);
    const text = ctx.mail.sent[0]?.mail.text ?? "";
    expect(text.match(/queued -> sent/g)).toHaveLength(40);
    expect(text).toContain("and 5 more, see http://kickrocks.test/requests");
  });

  it("keeps the period open and retries later when the mailbox refuses the mail", async () => {
    needsYou();
    ctx.mail.failNextSend(new Error("SMTP login rejected"));

    const result = await sendDigest(ctx.services);

    expect(result).toEqual({ outcome: "failed", sent: 0, error: "SMTP login rejected" });
    expect(readState(ctx.services)).toMatchObject({
      digestLastSentAt: "2026-10-06T08:00:00.000Z",
      digestLastError: "SMTP login rejected",
      digestRetryAfter: "2026-10-07T12:15:00.000Z",
    });
  });
});

describe("without a mailbox", () => {
  it("says so and tries again later", async () => {
    const result = await sendDigest(ctx.services);
    expect(result).toEqual({
      outcome: "no_mailbox",
      sent: 0,
      error: "Connect a mailbox to receive the digest",
    });
    expect(readState(ctx.services).digestRetryAfter).not.toBeNull();
  });
});

describe("sendDigestIfDue", () => {
  it("sends at the scheduled hour and not again until the next slot", async () => {
    configureDigest({ hourUtc: 8 });
    seedMessage(ctx, { mailboxId: seedMailbox(ctx, profileId).id });
    updateState(ctx.services, () => ({ digestLastSentAt: "2026-10-06T08:00:00.000Z" }));

    expect(await sendDigestIfDue(ctx.services)).toMatchObject({ outcome: "sent" });
    expect(await sendDigestIfDue(ctx.services)).toBeNull();
    expect(ctx.mail.sent).toHaveLength(1);

    ctx.clock.advance(DAY);
    expect(await sendDigestIfDue(ctx.services)).toMatchObject({ outcome: "sent" });
    expect(ctx.mail.sent).toHaveLength(2);
  });
});
