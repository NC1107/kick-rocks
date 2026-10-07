import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAY, HOUR, MINUTE } from "../test-utils/clock.js";
import {
  createTestContext,
  seedMailbox,
  seedProfile,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { QUOTA_WINDOW_MS } from "./mail-quota.js";

let ctx: TestContext;
let mailboxId: string;
let requestId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  const profile = seedProfile(ctx);
  mailboxId = seedMailbox(ctx, profile.id, { dailyCap: 5 }).id;
  requestId = seedRequest(ctx, { profileId: profile.id, targetId: seedTarget(ctx).id }).id;
});

afterEach(async () => {
  await ctx.close();
});

const quota = () => ctx.services.mailQuota;
const send = (kind: "initial" | "follow_up" = "initial") =>
  quota().record({ mailboxId, requestId, kind, messageId: `<m${Math.random()}@example.test>` });

describe("mailQuota", () => {
  it("counts what a mailbox sent in the last 24 hours, and drops the rest as the day rolls", () => {
    send();
    ctx.clock.advance(HOUR);
    send();
    send("follow_up");
    expect(quota().sentLastDay(mailboxId)).toBe(3);
    ctx.clock.advance(DAY - HOUR - MINUTE);
    expect(quota().sentLastDay(mailboxId)).toBe(3);
    ctx.clock.advance(2 * MINUTE);
    expect(quota().sentLastDay(mailboxId)).toBe(2);
    ctx.clock.advance(HOUR);
    expect(quota().sentLastDay(mailboxId)).toBe(0);
  });

  it("counts from any moment, with the same rule the daily count uses", () => {
    send();
    ctx.clock.advance(2 * HOUR);
    send();
    const start = ctx.clock.now().getTime();
    expect(quota().sentSince(mailboxId, new Date(start - 3 * HOUR))).toBe(2);
    expect(quota().sentSince(mailboxId, new Date(start - HOUR))).toBe(1);
    expect(quota().sentSince(mailboxId, new Date(start))).toBe(0);
    expect(quota().sentSince(mailboxId, new Date(start - QUOTA_WINDOW_MS))).toBe(
      quota().sentLastDay(mailboxId),
    );
  });

  it("says how many more may go out before the cap, and never less than none", () => {
    expect(quota().remaining(mailboxId)).toBe(5);
    for (let i = 0; i < 3; i++) send();
    expect(quota().remaining(mailboxId)).toBe(2);
    for (let i = 0; i < 4; i++) send();
    expect(quota().remaining(mailboxId)).toBe(0);
    ctx.clock.advance(DAY + MINUTE);
    expect(quota().remaining(mailboxId)).toBe(5);
  });

  it("keeps mailboxes apart", () => {
    const other = seedMailbox(ctx, seedProfile(ctx).id, { dailyCap: 9 }).id;
    send();
    expect(quota().sentLastDay(other)).toBe(0);
    expect(quota().remaining(other)).toBe(9);
  });

  it("knows when the last message went out, for the gap between sends", () => {
    expect(quota().lastSentAt(mailboxId)).toBeNull();
    send();
    ctx.clock.advance(40_000);
    send();
    expect(quota().lastSentAt(mailboxId)?.toISOString()).toBe(ctx.clock.now().toISOString());
  });

  it("stamps a send with the injected clock", () => {
    send();
    expect(quota().lastSentAt(mailboxId)?.toISOString()).toBe(ctx.clock.now().toISOString());
  });

  it("throws a 404 for a mailbox that does not exist", () => {
    expect(() => quota().remaining("missing")).toThrow(
      expect.objectContaining({ status: 404, code: "mailbox_not_found" }),
    );
  });

  it("forgets a mailbox's sends when the mailbox goes", () => {
    send();
    ctx.services.db.$client.prepare("delete from mailboxes where id = ?").run(mailboxId);
    expect(
      ctx.services.db.$client.prepare("select count(*) as n from outgoing_mail").get(),
    ).toEqual({
      n: 0,
    });
  });
});
