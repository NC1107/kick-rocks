import { requests as requestsTable, tasks } from "@kickrocks/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FAKE_STATUTE } from "../test-utils/fake-legal.js";
import {
  createTestContext,
  seedMailbox,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

const requests = () => ctx.services.requests;
const rows = () => ctx.services.db.select().from(requestsTable).all();
const taskRows = () => ctx.services.db.select().from(tasks).all();

function setup(state: "TX" | "CA" = "TX") {
  const profile = seedProfile(ctx, { state });
  const mailbox = seedMailbox(ctx, profile.id);
  return { profile, mailbox, target: seedTarget(ctx) };
}

describe("requests.open", () => {
  it("creates the request, queues it, and dispatches it in one go", () => {
    const { profile, mailbox, target } = setup();
    const { request, dispatch } = requests().open({
      profileId: profile.id,
      targetId: target.id,
      rights: ["opt_out", "delete"],
      channel: "email",
      actor: "user",
    });
    expect(request).toMatchObject({
      status: "queued",
      channel: "email",
      rights: ["opt_out", "delete"],
      mailboxId: mailbox.id,
      legalBasis: "policy",
      campaignId: null,
      recordUrl: null,
    });
    expect(dispatch).toMatchObject({
      created: true,
      task: { kind: "email_send", requestId: request.id },
    });
    expect(
      requests()
        .events(request.id)
        .map((e) => e.type),
    ).toEqual(["created", "status_changed", "queued", "task_enqueued"]);
    expect(
      requests()
        .events(request.id)
        .map((e) => e.actor),
    ).toEqual(["user", "user", "user", "system"]);
    expect(requests().events(request.id)[2]?.payload).toEqual({ channel: "email", reason: "new" });
  });

  it("resolves the legal basis from the profile's state, the target, and the rights", () => {
    const { profile, target } = setup("CA");
    const { request } = requests().open({
      profileId: profile.id,
      targetId: target.id,
      rights: ["opt_out"],
      channel: "email",
      actor: "system",
    });
    expect(request.legalBasis).toBe(FAKE_STATUTE.id);
  });

  it("refuses a record on another site and leaves nothing behind", () => {
    const { profile, target } = setup();
    expect(() =>
      requests().open({
        profileId: profile.id,
        targetId: target.id,
        rights: ["opt_out"],
        channel: "form",
        recordUrl: "https://collector.example/p/1",
        actor: "user",
      }),
    ).toThrow(/not on/);
    expect(ctx.services.db.select().from(requestsTable).all()).toHaveLength(0);
  });

  it("carries the campaign and the record a person confirmed", () => {
    const { profile, mailbox } = setup();
    const target = seedTarget(ctx, { domain: "broker.test" });
    seedRecipe(ctx, target.id, { purpose: "remove" });
    const { request, dispatch } = requests().open({
      profileId: profile.id,
      targetId: target.id,
      rights: ["opt_out"],
      channel: "form",
      recordUrl: "https://broker.test/p/9",
      actor: "user",
    });
    expect(request).toMatchObject({
      channel: "form",
      recordUrl: "https://broker.test/p/9",
      mailboxId: mailbox.id,
    });
    expect(dispatch.task).toMatchObject({
      kind: "form",
      payload: { recordUrl: "https://broker.test/p/9" },
    });
  });

  it("opens a form request for a profile with no mailbox when nothing in the flow needs one", () => {
    const profile = seedProfile(ctx);
    const target = seedTarget(ctx);
    const { request } = requests().open({
      profileId: profile.id,
      targetId: target.id,
      rights: ["opt_out"],
      channel: "form",
      actor: "user",
    });
    expect(request.mailboxId).toBeNull();
    expect(request.status).toBe("queued");
  });

  describe("when it cannot go out it leaves nothing behind", () => {
    const attempt = (profileId: string, targetId: string, channel: "email" | "form" = "email") =>
      requests().open({ profileId, targetId, rights: ["opt_out"], channel, actor: "user" });

    it("for a profile without a mailbox", () => {
      const profile = seedProfile(ctx);
      const target = seedTarget(ctx);
      expect(() => attempt(profile.id, target.id)).toThrow(
        expect.objectContaining({ code: "mailbox_required" }),
      );
      expect(rows()).toEqual([]);
      expect(taskRows()).toEqual([]);
    });

    it("for a target with no email address", () => {
      const { profile } = setup();
      const target = seedTarget(ctx, { privacyEmail: null, contactMethod: "form" });
      expect(() => attempt(profile.id, target.id)).toThrow(
        expect.objectContaining({ code: "no_email_address" }),
      );
      expect(rows()).toEqual([]);
    });

    it("for a record-first target without a record", () => {
      const { profile } = setup();
      const target = seedTarget(ctx, { category: "people-search" });
      expect(() => attempt(profile.id, target.id, "form")).toThrow(
        expect.objectContaining({ code: "record_url_required" }),
      );
      expect(rows()).toEqual([]);
      expect(taskRows()).toEqual([]);
    });

    it("for a profile or target that does not exist", () => {
      const { profile, target } = setup();
      expect(() => attempt("missing", target.id)).toThrow(
        expect.objectContaining({ status: 404, code: "profile_not_found" }),
      );
      expect(() => attempt(profile.id, "missing")).toThrow(
        expect.objectContaining({ status: 404, code: "target_not_found" }),
      );
      expect(rows()).toEqual([]);
    });

    it("for a target that left the dataset", () => {
      const { profile } = setup();
      const target = seedTarget(ctx);
      ctx.services.db.$client.prepare("update targets set retired = 1 where id = ?").run(target.id);
      expect(() => attempt(profile.id, target.id)).toThrow(
        expect.objectContaining({ status: 409, code: "target_retired" }),
      );
      expect(rows()).toEqual([]);
    });
  });
});

describe("requests.requeue", () => {
  function awaitingReply(channel: "email" | "form" = "email") {
    const { profile, target } = setup();
    const request = seedRequest(ctx, {
      profileId: profile.id,
      targetId: target.id,
      status: "awaiting_reply",
      channel,
      sentAt: ctx.clock.now().toISOString(),
    });
    return { profile, target, request };
  }

  it("moves the request back to queued and dispatches the kind it was told", () => {
    const { request } = awaitingReply();
    const result = requests().requeue(request.id, {
      actor: "user",
      reason: "follow_up",
      kind: "follow_up",
    });
    expect(result.request.status).toBe("queued");
    expect(result.dispatch.task).toMatchObject({
      kind: "email_send",
      payload: { requestId: request.id, kind: "follow_up", fields: [] },
    });
    expect(
      requests()
        .events(request.id)
        .map((e) => e.type),
    ).toEqual(["created", "status_changed", "queued", "task_enqueued"]);
    expect(requests().events(request.id)[2]?.payload).toEqual({
      channel: "email",
      reason: "follow_up",
    });
  });

  it("sends a verification reply with the approved fields and the message it answers", () => {
    const { profile, target } = setup();
    const request = seedRequest(ctx, {
      profileId: profile.id,
      targetId: target.id,
      status: "needs_verification",
      sentAt: ctx.clock.now().toISOString(),
    });
    const { dispatch } = requests().requeue(request.id, {
      actor: "user",
      reason: "verification_reply",
      kind: "verification_reply",
      fields: ["date_of_birth"],
      inReplyTo: "<ask@broker.test>",
      events: [{ type: "user_action", payload: { action: "verification_reply", note: null } }],
    });
    expect(dispatch.task.payload).toEqual({
      requestId: request.id,
      kind: "verification_reply",
      fields: ["date_of_birth"],
      inReplyTo: "<ask@broker.test>",
    });
    expect(
      requests()
        .events(request.id)
        .map((e) => e.type),
    ).toContain("user_action");
  });

  it("switches channel as it goes out again, and writes the event the caller names", () => {
    const { request, target } = awaitingReply();
    seedRecipe(ctx, target.id, { purpose: "remove" });
    const { request: moved, dispatch } = requests().requeue(request.id, {
      actor: "system",
      reason: "channel_switch",
      kind: "initial",
      channel: "form",
      events: [
        { type: "channel_switched", payload: { from: "email", to: "form", reason: "needs_form" } },
      ],
    });
    expect(moved).toMatchObject({ status: "queued", channel: "form" });
    expect(dispatch.task.kind).toBe("form");
    expect(
      requests()
        .events(request.id)
        .map((e) => e.type),
    ).toContain("channel_switched");
  });

  it("applies a patch together with the move", () => {
    const { request } = awaitingReply();
    const { request: moved } = requests().requeue(request.id, {
      actor: "system",
      reason: "retry",
      kind: "initial",
      patch: { followUps: 3, lastError: null },
    });
    expect(moved.followUps).toBe(3);
  });

  it("refuses a move the machine does not allow and changes nothing", () => {
    const { profile, target } = setup();
    const draft = seedRequest(ctx, {
      profileId: profile.id,
      targetId: target.id,
      status: "confirmed",
    });
    expect(() =>
      requests().requeue(draft.id, { actor: "system", reason: "resend", kind: "initial" }),
    ).toThrow(expect.objectContaining({ code: "invalid_transition" }));
    expect(requests().getOrThrow(draft.id).status).toBe("confirmed");
    expect(taskRows()).toEqual([]);
  });

  it("puts the request back as it was when it cannot be dispatched", () => {
    const { request } = awaitingReply("form");
    // A record-first target with no record: dispatch refuses, so the move must not stick.
    ctx.services.db.$client
      .prepare("update targets set category = 'people-search' where id = ?")
      .run(request.targetId);
    expect(() =>
      requests().requeue(request.id, { actor: "user", reason: "resend", kind: "initial" }),
    ).toThrow(expect.objectContaining({ code: "record_url_required" }));
    expect(requests().getOrThrow(request.id).status).toBe("awaiting_reply");
    expect(
      requests()
        .events(request.id)
        .map((e) => e.type),
    ).toEqual(["created"]);
    expect(taskRows()).toEqual([]);
  });
});
