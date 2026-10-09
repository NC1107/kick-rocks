import { outgoingMail, targets } from "@kickrocks/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunners } from "../runners/index.js";
import {
  createTestContext,
  seedMailbox,
  seedProfile,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { moveRequestsToFormAfterEmailLoss } from "./email-loss.js";

let ctx: TestContext;
let profileId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  seedMailbox(ctx, profileId);
});

afterEach(async () => {
  await ctx.close();
});

const requestOf = (id: string) => ctx.services.requests.getOrThrow(id);
const eventTypes = (id: string) => ctx.services.requests.events(id).map((event) => event.type);

function openEmailRequest() {
  const target = seedTarget(ctx, {
    privacyEmail: "privacy@broker.example",
    optOutUrl: "https://broker.example/optout",
    contactMethod: "both",
  });
  const { request } = ctx.services.requests.open({
    profileId,
    targetId: target.id,
    rights: ["opt_out"],
    channel: "email",
    actor: "user",
  });
  return { target, request };
}

const dropEmail = (targetId: string) =>
  ctx.services.db
    .update(targets)
    .set({ privacyEmail: null, contactMethod: "form" })
    .where(eq(targets.id, targetId))
    .run();

describe("moveRequestsToFormAfterEmailLoss", () => {
  it("moves a queued email request that was never sent to the form, with the switch on the timeline", () => {
    const { target, request } = openEmailRequest();
    dropEmail(target.id);

    expect(moveRequestsToFormAfterEmailLoss(ctx.services, [target.id])).toBe(1);

    expect(requestOf(request.id)).toMatchObject({ status: "queued", channel: "form" });
    expect(
      ctx.services.taskQueue.list({
        requestId: request.id,
        kinds: ["email_send"],
        status: "queued",
      }),
    ).toEqual([]);
    expect(eventTypes(request.id)).toContain("channel_switched");
  });

  it("moves a request that was mailed before recipients were recorded, so its follow-ups do not stop silently", async () => {
    const { target, request } = openEmailRequest();
    await createRunners(ctx.services, { random: () => 0 }).email.runDue();
    ctx.services.db.update(outgoingMail).set({ recipient: null }).run();
    dropEmail(target.id);

    moveRequestsToFormAfterEmailLoss(ctx.services, [target.id]);

    expect(requestOf(request.id)).toMatchObject({ status: "queued", channel: "form" });
  });

  it("leaves a request alone whose first mail has a recorded recipient, because follow-ups still have somewhere to go", async () => {
    const { target, request } = openEmailRequest();
    await createRunners(ctx.services, { random: () => 0 }).email.runDue();
    dropEmail(target.id);

    expect(moveRequestsToFormAfterEmailLoss(ctx.services, [target.id])).toBe(0);

    expect(requestOf(request.id)).toMatchObject({ status: "awaiting_reply", channel: "email" });
  });

  it("keeps a request on email when the broker has no form to move it to", () => {
    const { target, request } = openEmailRequest();
    ctx.services.db
      .update(targets)
      .set({ privacyEmail: null, optOutUrl: null, contactMethod: "unknown" })
      .where(eq(targets.id, target.id))
      .run();

    expect(moveRequestsToFormAfterEmailLoss(ctx.services, [target.id])).toBe(0);

    expect(requestOf(request.id).channel).toBe("email");
  });

  it("does nothing for a target that kept its address", () => {
    const { request } = openEmailRequest();
    expect(moveRequestsToFormAfterEmailLoss(ctx.services, [])).toBe(0);
    expect(requestOf(request.id).channel).toBe("email");
  });
});
