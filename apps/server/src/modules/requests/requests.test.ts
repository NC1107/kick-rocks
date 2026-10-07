import { messages, requests as requestsTable, targets, tasks } from "@kickrocks/db";
import { API_ROUTES, availableActions, RequestAction, RequestStatus } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  jordanIdentities,
  MINUTE,
  SECOND,
  seedIdentities,
  seedMailbox,
  seedMessage,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedTarget,
  seedTask,
  type TestContext,
} from "../../test-utils/index.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

function setup() {
  const profile = seedProfile(ctx);
  const mailbox = seedMailbox(ctx, profile.id);
  const target = seedTarget(ctx, { id: "broker", name: "Example Broker" });
  return { profile, mailbox, target };
}

const list = (profileId: string, query: Record<string, unknown> = {}) =>
  ctx.call(API_ROUTES.requestsList, { params: { id: profileId }, query: query as never });
const get = (id: string) => ctx.call(API_ROUTES.requestsGet, { params: { id } });
const act = (id: string, action: RequestAction) =>
  ctx.call(API_ROUTES.requestsAct, { params: { id }, body: { action } });

async function listed(profileId: string, query: Record<string, unknown> = {}) {
  const result = await list(profileId, query);
  if (!result.ok) throw new Error(`list failed: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function detailOf(id: string) {
  const result = await get(id);
  if (!result.ok) throw new Error(`get failed: ${JSON.stringify(result.body)}`);
  return result.body;
}

const reread = (id: string) => ctx.services.requests.getOrThrow(id);
const taskRows = () => ctx.services.db.select().from(tasks).all();

describe("GET /profiles/:id/requests", () => {
  it("lists a profile's requests with their targets, newest activity first", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "other", name: "Other Broker" });
    const first = seedRequest(ctx, { profileId: profile.id, targetId: "broker" });
    ctx.clock.advance(MINUTE);
    const second = seedRequest(ctx, { profileId: profile.id, targetId: "other" });
    ctx.clock.advance(MINUTE);
    ctx.services.requests.update(first.id, { lastError: "touched" });

    const body = await listed(profile.id);

    expect(body.items.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(body.items[0]?.target).toMatchObject({ id: "broker", name: "Example Broker" });
    expect(body).toMatchObject({ total: 2, page: 1 });
  });

  it("never shows another profile's requests", async () => {
    const { profile } = setup();
    const other = seedProfile(ctx, { displayName: "Sam Example" });
    seedRequest(ctx, { profileId: profile.id, targetId: "broker" });
    seedRequest(ctx, { profileId: other.id, targetId: "broker" });

    expect((await listed(profile.id)).total).toBe(1);
    expect((await listed(other.id)).total).toBe(1);
  });

  it("filters by one or several statuses, channel, and target", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "other" });
    const queued = seedRequest(ctx, {
      profileId: profile.id,
      targetId: "broker",
      status: "queued",
    });
    const waiting = seedRequest(ctx, {
      profileId: profile.id,
      targetId: "other",
      status: "awaiting_reply",
      channel: "form",
    });
    const done = seedRequest(ctx, {
      profileId: profile.id,
      targetId: "other",
      status: "confirmed",
    });
    const ids = async (query: Record<string, unknown>) =>
      (await listed(profile.id, query)).items.map((item) => item.id).sort();

    expect(await ids({ status: "queued" })).toEqual([queued.id]);
    expect(await ids({ status: "queued,confirmed" })).toEqual([queued.id, done.id].sort());
    expect(await ids({ channel: "form" })).toEqual([waiting.id]);
    expect(await ids({ targetId: "other" })).toEqual([waiting.id, done.id].sort());
    expect(await ids({ targetId: "other", status: "confirmed" })).toEqual([done.id]);
    expect(await ids({ status: "needs_verification" })).toEqual([]);
  });

  it("searches the target's name and domain and the request reference", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "acme", name: "Acme Lists", domain: "acme-lists.test" });
    const request = seedRequest(ctx, { profileId: profile.id, targetId: "acme" });
    seedRequest(ctx, { profileId: profile.id, targetId: "broker" });
    const ids = async (q: string) => (await listed(profile.id, { q })).items.map((item) => item.id);

    expect(await ids("acme")).toEqual([request.id]);
    expect(await ids("LISTS.test")).toEqual([request.id]);
    expect(await ids(request.reference)).toEqual([request.id]);
    expect(await ids(request.reference.toLowerCase())).toEqual([request.id]);
    expect(await ids("%")).toEqual([]);
    expect(await ids("zzz")).toEqual([]);
  });

  it("paginates and reports the total", async () => {
    const { profile } = setup();
    for (let i = 0; i < 5; i += 1) {
      seedRequest(ctx, { profileId: profile.id, targetId: "broker" });
      ctx.clock.advance(SECOND);
    }

    const second = await listed(profile.id, { pageSize: 2, page: 2 });
    expect(second.items).toHaveLength(2);
    expect(second).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect((await listed(profile.id, { pageSize: 2, page: 4 })).items).toEqual([]);
  });

  it("answers 400 for an unknown status and 404 for an unknown profile", async () => {
    const { profile } = setup();
    const bad = await list(profile.id, { status: "queued,bogus", channel: "fax", pageSize: 0 });
    expect(bad).toMatchObject({ ok: false, status: 400 });
    expect(!bad.ok && bad.body.issues?.map((issue) => issue.path[0])).toEqual(
      expect.arrayContaining(["query"]),
    );
    expect(await list("missing")).toMatchObject({
      ok: false,
      status: 404,
      body: { error: "profile_not_found" },
    });
  });
});

describe("GET /requests/:id", () => {
  it("returns the timeline, messages, tasks, target, and the actions on offer", async () => {
    const { profile, mailbox } = setup();
    const { request } = ctx.services.requests.open({
      profileId: profile.id,
      targetId: "broker",
      rights: ["opt_out"],
      channel: "email",
      actor: "user",
    });
    const reply = seedMessage(ctx, {
      mailboxId: mailbox.id,
      requestId: request.id,
      classification: "auto_ack",
      confidence: 0.9,
      subject: `Re: ${request.reference}`,
    });
    seedMessage(ctx, { mailboxId: mailbox.id, requestId: null });

    const detail = await detailOf(request.id);

    expect(detail).toMatchObject({
      id: request.id,
      status: "queued",
      reference: request.reference,
      target: { id: "broker", name: "Example Broker", needsRecord: false },
    });
    expect(detail.events.map((event) => event.type)).toEqual([
      "created",
      "status_changed",
      "queued",
      "task_enqueued",
    ]);
    expect(detail.messages.map((message) => message.id)).toEqual([reply.id]);
    expect(detail.tasks).toMatchObject([
      { kind: "email_send", status: "queued", requestId: request.id, targetName: "Example Broker" },
    ]);
    expect(detail.actions).toEqual(["cancel", "mark_confirmed", "mark_rejected", "mark_no_record"]);
  });

  it("lists messages oldest first", async () => {
    const { profile, mailbox } = setup();
    const request = seedRequest(ctx, { profileId: profile.id, targetId: "broker" });
    const later = seedMessage(ctx, {
      mailboxId: mailbox.id,
      requestId: request.id,
      receivedAt: "2026-10-05T10:00:00.000Z",
    });
    const earlier = seedMessage(ctx, {
      mailboxId: mailbox.id,
      requestId: request.id,
      receivedAt: "2026-10-04T10:00:00.000Z",
    });

    const detail = await detailOf(request.id);

    expect(detail.messages.map((message) => message.id)).toEqual([earlier.id, later.id]);
  });

  it("does not put message text or other stored fields on the page", async () => {
    const { profile, mailbox } = setup();
    const request = seedRequest(ctx, { profileId: profile.id, targetId: "broker" });
    seedMessage(ctx, { mailboxId: mailbox.id, requestId: request.id, text: "private body" });

    const detail = await detailOf(request.id);

    expect(JSON.stringify(detail)).not.toContain("private body");
    expect(detail.messages[0]).not.toHaveProperty("text");
  });

  it.each(RequestStatus.options)(
    "offers exactly what availableActions says for %s",
    async (status) => {
      const { profile } = setup();
      const request = seedRequest(ctx, { profileId: profile.id, targetId: "broker", status });

      const detail = await detailOf(request.id);

      expect(detail.actions).toEqual(availableActions({ status }, { hasLiveTask: false }));
    },
  );

  it("stops offering a resend from queued once a task is live", async () => {
    const { profile } = setup();
    const { request } = ctx.services.requests.open({
      profileId: profile.id,
      targetId: "broker",
      rights: ["opt_out"],
      channel: "email",
      actor: "user",
    });
    expect((await detailOf(request.id)).actions).not.toContain("resend");

    ctx.services.db.delete(tasks).run();
    expect((await detailOf(request.id)).actions).toContain("resend");
  });

  it("answers 404 for a request that does not exist", async () => {
    expect(await get("nope")).toMatchObject({
      ok: false,
      status: 404,
      body: { error: "request_not_found" },
    });
  });
});

describe("POST /requests/:id/actions", () => {
  const OUTCOMES = [
    ["cancel", "cancelled"],
    ["mark_confirmed", "confirmed"],
    ["mark_rejected", "rejected"],
    ["mark_no_record", "no_record"],
  ] as const;

  it.each(OUTCOMES)(
    "%s moves the request to %s and records what the person did",
    async (action, status) => {
      const { profile } = setup();
      const request = seedRequest(ctx, {
        profileId: profile.id,
        targetId: "broker",
        status: "awaiting_reply",
      });

      const result = await act(request.id, action);

      expect(result).toMatchObject({ ok: true, body: { id: request.id, status } });
      const events = ctx.services.requests.events(request.id);
      expect(events.slice(-2).map((event) => [event.type, event.actor])).toEqual([
        ["status_changed", "user"],
        ["user_action", "user"],
      ]);
      expect(events.at(-2)?.payload).toEqual({ from: "awaiting_reply", to: status });
      expect(events.at(-1)?.payload).toEqual({ action, note: null });
    },
  );

  it("cancels the live tasks of a request that is settled by hand", async () => {
    const { profile } = setup();
    const { request } = ctx.services.requests.open({
      profileId: profile.id,
      targetId: "broker",
      rights: ["opt_out"],
      channel: "email",
      actor: "user",
    });
    expect(taskRows().map((task) => task.status)).toEqual(["queued"]);

    const result = await act(request.id, "cancel");

    expect(result.ok && result.body.tasks.map((task) => task.status)).toEqual(["cancelled"]);
    expect(result.ok && result.body.actions).toEqual([]);
  });

  it("answers the new detail, with the timeline including the action", async () => {
    const { profile } = setup();
    const request = seedRequest(ctx, { profileId: profile.id, targetId: "broker", status: "sent" });

    const result = await act(request.id, "mark_confirmed");

    expect(result.ok && result.body.events.map((event) => event.type)).toEqual([
      "created",
      "status_changed",
      "user_action",
    ]);
  });

  it.each(
    RequestStatus.options.flatMap((status) =>
      RequestAction.options.map((action) => [status, action] as const),
    ),
  )("from %s, %s is accepted exactly when availableActions offers it", async (status, action) => {
    const { profile } = setup();
    const request = seedRequest(ctx, { profileId: profile.id, targetId: "broker", status });
    const offered = availableActions({ status }, { hasLiveTask: false }).includes(action);

    const result = await act(request.id, action);

    if (offered) {
      expect(result.ok, `${status} ${action}`).toBe(true);
    } else {
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        body: { error: "action_not_available" },
      });
      expect(reread(request.id).status).toBe(status);
      expect(ctx.services.requests.events(request.id).map((event) => event.type)).toEqual([
        "created",
      ]);
    }
  });

  it("answers 400 for an unknown action and 404 for an unknown request", async () => {
    const { profile } = setup();
    const request = seedRequest(ctx, { profileId: profile.id, targetId: "broker" });
    const bad = await ctx.call(API_ROUTES.requestsAct, {
      params: { id: request.id },
      body: { action: "delete_everything" } as never,
    });
    expect(bad).toMatchObject({ ok: false, status: 400 });
    expect(await act("nope", "cancel")).toMatchObject({ ok: false, status: 404 });
  });

  describe("resend", () => {
    it.each([
      ["rejected", "initial"],
      ["bounced", "initial"],
      ["awaiting_reply", "follow_up"],
      ["no_response", "follow_up"],
      ["follow_up_due", "follow_up"],
    ] as const)("from %s queues a %s email on the same channel", async (status, kind) => {
      const { profile, mailbox } = setup();
      const request = seedRequest(ctx, {
        profileId: profile.id,
        targetId: "broker",
        status,
        sentAt: ctx.clock.now().toISOString(),
      });

      const result = await act(request.id, "resend");

      expect(result).toMatchObject({ ok: true, body: { status: "queued", channel: "email" } });
      const [task] = taskRows();
      expect(task).toMatchObject({ kind: "email_send", status: "queued", requestId: request.id });
      expect(task?.payload).toMatchObject({ kind, fields: [], inReplyTo: null });
      const events = ctx.services.requests.events(request.id);
      expect(events.map((event) => event.type)).toEqual([
        "created",
        "status_changed",
        "queued",
        "user_action",
        "task_enqueued",
      ]);
      expect(events.find((event) => event.type === "queued")?.payload).toEqual({
        channel: "email",
        reason: "resend",
      });
      expect(events.find((event) => event.type === "user_action")?.payload).toEqual({
        action: "resend",
        note: null,
      });
      expect(reread(request.id).mailboxId ?? mailbox.id).toBe(mailbox.id);
    });

    it("sends a request that never went out as a new one, not a follow-up", async () => {
      const { profile } = setup();
      const request = seedRequest(ctx, {
        profileId: profile.id,
        targetId: "broker",
        status: "awaiting_reply",
        sentAt: null,
      });

      await act(request.id, "resend");

      expect(taskRows()[0]?.payload).toMatchObject({ kind: "initial" });
    });

    it("dispatches a queued request that has nothing live to send it", async () => {
      const { profile } = setup();
      const request = seedRequest(ctx, {
        profileId: profile.id,
        targetId: "broker",
        status: "queued",
      });
      expect(taskRows()).toEqual([]);

      const result = await act(request.id, "resend");

      expect(result).toMatchObject({ ok: true, body: { status: "queued" } });
      expect(taskRows()).toMatchObject([{ kind: "email_send", requestId: request.id }]);
      expect(taskRows()[0]?.payload).toMatchObject({ kind: "initial" });
      expect(ctx.services.requests.events(request.id).map((event) => event.type)).toEqual([
        "created",
        "user_action",
        "task_enqueued",
      ]);
    });

    it("refuses a queued request that already has a task", async () => {
      const { profile } = setup();
      const { request } = ctx.services.requests.open({
        profileId: profile.id,
        targetId: "broker",
        rights: ["opt_out"],
        channel: "email",
        actor: "user",
      });

      const result = await act(request.id, "resend");

      expect(result).toMatchObject({
        ok: false,
        status: 409,
        body: { error: "action_not_available" },
      });
      expect(taskRows()).toHaveLength(1);
    });

    it("queues a form request again as a form task", async () => {
      const { profile } = setup();
      seedTarget(ctx, { id: "form-site", privacyEmail: null, contactMethod: "form" });
      seedRecipe(ctx, "form-site", {
        definition: {
          fields: ["record_url"],
          steps: [
            { kind: "goto", url: "https://form-site.test/optout" },
            { kind: "fill", target: { label: "Profile URL" }, field: "record_url" },
            { kind: "click", target: { role: "button", label: "Remove" } },
          ],
        },
      });
      const request = seedRequest(ctx, {
        profileId: profile.id,
        targetId: "form-site",
        channel: "form",
        status: "rejected",
      });

      const result = await act(request.id, "resend");

      expect(result).toMatchObject({ ok: true, body: { status: "queued", channel: "form" } });
      expect(taskRows()).toMatchObject([{ kind: "form", requestId: request.id }]);
    });

    it("leaves the request untouched when it cannot be dispatched", async () => {
      const profile = seedProfile(ctx);
      seedTarget(ctx, { id: "broker" });
      const request = seedRequest(ctx, {
        profileId: profile.id,
        targetId: "broker",
        status: "rejected",
      });

      const result = await act(request.id, "resend");

      expect(result).toMatchObject({ ok: false, status: 409, body: { error: "mailbox_required" } });
      expect(reread(request.id).status).toBe("rejected");
      expect(ctx.services.requests.events(request.id).map((event) => event.type)).toEqual([
        "created",
      ]);
      expect(taskRows()).toEqual([]);
    });

    it("refuses a request whose target left the dataset", async () => {
      const { profile } = setup();
      const request = seedRequest(ctx, {
        profileId: profile.id,
        targetId: "broker",
        status: "rejected",
      });
      ctx.services.db.update(targets).set({ retired: true }).where(eq(targets.id, "broker")).run();

      const result = await act(request.id, "resend");

      expect(result).toMatchObject({ ok: false, status: 409, body: { error: "target_retired" } });
      expect(reread(request.id).status).toBe("rejected");
    });

    it("allows a resend while a confirmation task is live on an awaiting request", async () => {
      const { profile } = setup();
      const request = seedRequest(ctx, {
        profileId: profile.id,
        targetId: "broker",
        status: "awaiting_reply",
        sentAt: ctx.clock.now().toISOString(),
      });
      seedTask(ctx, {
        kind: "confirm",
        payload: { requestId: request.id, url: "https://broker.test/confirm?t=1" },
        profileId: profile.id,
        targetId: "broker",
        requestId: request.id,
      });

      const result = await act(request.id, "resend");

      expect(result.ok).toBe(true);
    });
  });
});

describe("POST /requests/:id/verification", () => {
  function waitingForVerification(
    requestedFields: ("date_of_birth" | "street" | "phone")[] = ["date_of_birth", "street"],
  ) {
    const { profile, mailbox } = setup();
    const request = seedRequest(ctx, {
      profileId: profile.id,
      targetId: "broker",
      status: "needs_verification",
      sentAt: ctx.clock.now().toISOString(),
    });
    const message = seedMessage(ctx, {
      mailboxId: mailbox.id,
      requestId: request.id,
      classification: "verification_required",
      confidence: 0.9,
      requestedFields,
    });
    return { profile, mailbox, request, message };
  }

  const verify = (id: string, body: { messageId: string; fields: string[] }) =>
    ctx.call(API_ROUTES.requestsVerification, { params: { id }, body: body as never });

  it("queues a verification reply carrying only the approved fields, in reply to the broker's mail", async () => {
    const { request, message } = waitingForVerification();

    const result = await verify(request.id, { messageId: message.id, fields: ["date_of_birth"] });

    expect(result).toMatchObject({ ok: true, body: { status: "queued" } });
    const [task] = taskRows();
    expect(task).toMatchObject({ kind: "email_send", status: "queued", requestId: request.id });
    expect(task?.payload).toEqual({
      requestId: request.id,
      kind: "verification_reply",
      fields: ["date_of_birth"],
      inReplyTo: message.messageIdHeader,
    });
    const events = ctx.services.requests.events(request.id);
    expect(events.map((event) => event.type)).toEqual([
      "created",
      "status_changed",
      "queued",
      "user_action",
      "task_enqueued",
    ]);
    expect(events.find((event) => event.type === "queued")?.payload).toEqual({
      channel: "email",
      reason: "verification_reply",
    });
    expect(events.find((event) => event.type === "user_action")?.payload).toEqual({
      action: "verification_reply",
      note: null,
    });
  });

  it("can send everything that was asked for, and a repeated field once", async () => {
    const { request, message } = waitingForVerification();

    await verify(request.id, {
      messageId: message.id,
      fields: ["street", "date_of_birth", "street"],
    });

    expect(taskRows()[0]?.payload).toMatchObject({ fields: ["street", "date_of_birth"] });
  });

  it("marks the broker's message as dealt with", async () => {
    const { request, message } = waitingForVerification();
    expect(message.reviewed).toBe(false);

    await verify(request.id, { messageId: message.id, fields: ["street"] });

    const row = ctx.services.db.select().from(messages).where(eq(messages.id, message.id)).get();
    expect(row?.reviewed).toBe(true);
  });

  it("composes the reply with the approved identifiers and nothing else", async () => {
    const { request, message } = waitingForVerification();
    await verify(request.id, { messageId: message.id, fields: ["date_of_birth"] });

    const composed = ctx.services.composer.requestEmail(reread(request.id), "verification_reply", {
      requestedFields: ["date_of_birth"],
    });

    expect(Object.keys(composed.input.identifiers)).toContain("date_of_birth");
    expect(Object.keys(composed.input.identifiers)).not.toContain("street");
  });

  it("answers 400 pointing at each field the broker did not ask for, and sends nothing", async () => {
    const { request, message } = waitingForVerification(["date_of_birth"]);

    const result = await verify(request.id, {
      messageId: message.id,
      fields: ["date_of_birth", "street", "phone"],
    });

    expect(result).toMatchObject({ ok: false, status: 400, body: { error: "invalid_request" } });
    expect(!result.ok && result.body.issues?.map((issue) => issue.path)).toEqual([
      ["body", "fields", 1],
      ["body", "fields", 2],
    ]);
    expect(reread(request.id).status).toBe("needs_verification");
    expect(taskRows()).toEqual([]);
  });

  it("answers 400 for a detail the profile does not have, and leaves the request waiting", async () => {
    const { profile, request, message } = waitingForVerification();
    seedIdentities(
      ctx,
      profile.id,
      jordanIdentities().filter((identity) => identity.kind !== "dob"),
    );

    const result = await verify(request.id, {
      messageId: message.id,
      fields: ["street", "date_of_birth"],
    });

    expect(result).toMatchObject({ ok: false, status: 400, body: { error: "invalid_request" } });
    expect(!result.ok && result.body.issues).toEqual([
      { path: ["body", "fields", 1], message: "The profile has no date of birth to send" },
    ]);
    expect(reread(request.id).status).toBe("needs_verification");
    expect(taskRows()).toEqual([]);
  });

  it("answers 400 when no fields are approved", async () => {
    const { request, message } = waitingForVerification();
    const result = await verify(request.id, { messageId: message.id, fields: [] });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(!result.ok && result.body.issues?.[0]?.path[0]).toBe("body");
  });

  it("answers 404 for a message that belongs to another request or does not exist", async () => {
    const { profile, mailbox, request } = waitingForVerification();
    const otherRequest = seedRequest(ctx, {
      profileId: profile.id,
      targetId: "broker",
      status: "needs_verification",
    });
    const foreign = seedMessage(ctx, {
      mailboxId: mailbox.id,
      requestId: otherRequest.id,
      requestedFields: ["street"],
    });
    const stray = seedMessage(ctx, { mailboxId: mailbox.id, requestedFields: ["street"] });

    for (const messageId of [foreign.id, stray.id, "no-such-message"]) {
      const result = await verify(request.id, { messageId, fields: ["street"] });
      expect(result).toMatchObject({
        ok: false,
        status: 404,
        body: { error: "message_not_found" },
      });
    }
    expect(reread(request.id).status).toBe("needs_verification");
    expect(taskRows()).toEqual([]);
  });

  it.each(RequestStatus.options.filter((status) => status !== "needs_verification"))(
    "answers 409 when the request is %s",
    async (status) => {
      const { profile, mailbox } = setup();
      const request = seedRequest(ctx, { profileId: profile.id, targetId: "broker", status });
      const message = seedMessage(ctx, {
        mailboxId: mailbox.id,
        requestId: request.id,
        requestedFields: ["street"],
      });

      const result = await verify(request.id, { messageId: message.id, fields: ["street"] });

      expect(result).toMatchObject({
        ok: false,
        status: 409,
        body: { error: "invalid_request_state" },
      });
      expect(taskRows()).toEqual([]);
    },
  );

  it("answers 404 for an unknown request", async () => {
    expect(await verify("nope", { messageId: "m", fields: ["street"] })).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("changes nothing when the reply cannot be queued", async () => {
    const { request, message } = waitingForVerification();
    ctx.services.db
      .update(targets)
      .set({ privacyEmail: null })
      .where(eq(targets.id, "broker"))
      .run();

    const result = await verify(request.id, { messageId: message.id, fields: ["street"] });

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(reread(request.id).status).toBe("needs_verification");
    const row = ctx.services.db.select().from(messages).where(eq(messages.id, message.id)).get();
    expect(row?.reviewed).toBe(false);
    expect(ctx.services.db.select().from(requestsTable).all()).toHaveLength(1);
  });
});
