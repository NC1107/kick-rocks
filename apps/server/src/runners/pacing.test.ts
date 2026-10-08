import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAY } from "../test-utils/clock.js";
import {
  createTestContext,
  seedMailbox,
  seedProfile,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { MailPacer } from "./pacing.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

describe("MailPacer", () => {
  it("does not wait on the daily cap for sends stamped by a clock that ran ahead", () => {
    const profile = seedProfile(ctx);
    const mailbox = seedMailbox(ctx, profile.id, { dailyCap: 1 });
    const requestId = seedRequest(ctx, { profileId: profile.id, targetId: seedTarget(ctx).id }).id;
    const realNow = ctx.clock.now();
    ctx.clock.advance(3 * DAY);
    ctx.services.mailQuota.record({
      mailboxId: mailbox.id,
      requestId,
      kind: "initial",
      messageId: "<ahead@example.test>",
    });
    ctx.clock.set(realNow);

    expect(new MailPacer(ctx.services, () => 0).waitUntil(mailbox)).toBeNull();
  });
});
