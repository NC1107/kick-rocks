import { requests as requestsTable, targets as targetsTable } from "@kickrocks/db";
import { Reference } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SECOND } from "../test-utils/clock.js";
import {
  createTestContext,
  seedProfile,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { createRequestsService, type RequestsService } from "./requests.js";

let ctx: TestContext;
let requests: RequestsService;
let profileId: string;
let targetId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  requests = ctx.services.requests;
  profileId = seedProfile(ctx).id;
  targetId = seedTarget(ctx).id;
});

afterEach(async () => {
  await ctx.close();
});

function create(overrides: Partial<Parameters<RequestsService["create"]>[0]> = {}) {
  return requests.create({
    profileId,
    targetId,
    rights: ["opt_out"],
    legalBasis: "policy",
    channel: "email",
    ...overrides,
  });
}

describe("create", () => {
  it("makes a draft with a reference, defaults, and a created event", () => {
    const request = create({ rights: ["opt_out", "delete"], legalBasis: "ca-test-act" });
    expect(request).toMatchObject({
      status: "draft",
      rights: ["opt_out", "delete"],
      legalBasis: "ca-test-act",
      channel: "email",
      campaignId: null,
      mailboxId: null,
      recordUrl: null,
      outgoingMessageId: null,
      followUps: 0,
      sentAt: null,
      dueAt: null,
      followUpAt: null,
      lastError: null,
      createdAt: ctx.clock.now().toISOString(),
      updatedAt: ctx.clock.now().toISOString(),
    });
    expect(Reference.safeParse(request.reference).success).toBe(true);
    const [event, ...rest] = requests.events(request.id);
    expect(rest).toEqual([]);
    expect(event).toMatchObject({
      type: "created",
      actor: "system",
      payload: { channel: "email", reference: request.reference },
    });
  });

  it("gives every request its own reference", () => {
    const references = new Set(Array.from({ length: 50 }, () => create().reference));
    expect(references.size).toBe(50);
  });

  it("retries when a generated reference is taken", () => {
    const sequence = ["KR-AAAAAA", "KR-AAAAAA", "KR-BBBBBB"] as const;
    let call = 0;
    const service = createRequestsService({
      db: ctx.services.db,
      clock: ctx.clock,
      taskQueue: ctx.services.taskQueue,
      generateReference: () => sequence[Math.min(call++, sequence.length - 1)] as never,
    });
    expect(
      service.create({
        profileId,
        targetId,
        rights: ["opt_out"],
        legalBasis: "policy",
        channel: "email",
      }).reference,
    ).toBe("KR-AAAAAA");
    expect(
      service.create({
        profileId,
        targetId,
        rights: ["opt_out"],
        legalBasis: "policy",
        channel: "email",
      }).reference,
    ).toBe("KR-BBBBBB");
  });

  it("gives up if no unused reference can be found", () => {
    const service = createRequestsService({
      db: ctx.services.db,
      clock: ctx.clock,
      taskQueue: ctx.services.taskQueue,
      generateReference: () => "KR-AAAAAA",
    });
    service.create({
      profileId,
      targetId,
      rights: ["opt_out"],
      legalBasis: "policy",
      channel: "email",
    });
    expect(() =>
      service.create({
        profileId,
        targetId,
        rights: ["opt_out"],
        legalBasis: "policy",
        channel: "email",
      }),
    ).toThrow(/unused request reference/);
  });

  it("records who created it and keeps the record url", () => {
    const request = create({ actor: "user", recordUrl: "https://x.test/p/1" });
    expect(request.recordUrl).toBe("https://x.test/p/1");
    expect(requests.events(request.id)[0]?.actor).toBe("user");
  });

  it("answers a missing profile or target with a 404, not a database error", () => {
    expect(() => create({ profileId: "missing" })).toThrow(
      expect.objectContaining({ status: 404, code: "profile_not_found" }),
    );
    expect(() => create({ targetId: "missing" })).toThrow(
      expect.objectContaining({ status: 404, code: "target_not_found" }),
    );
    expect(ctx.services.db.select().from(requestsTable).all()).toEqual([]);
  });

  it("refuses a target that has left the dataset", () => {
    const retired = seedTarget(ctx, { id: "gone-broker" });
    ctx.services.db
      .update(targetsTable)
      .set({ retired: true })
      .where(eq(targetsTable.id, retired.id))
      .run();
    expect(() => create({ targetId: retired.id })).toThrow(
      expect.objectContaining({ status: 409, code: "target_retired" }),
    );
  });
});

describe("get", () => {
  it("finds by id and by reference", () => {
    const request = create();
    expect(requests.get(request.id)).toEqual(request);
    expect(requests.getByReference(request.reference)).toEqual(request);
    expect(requests.get("missing")).toBeNull();
    expect(requests.getByReference("KR-ZZZZZZ")).toBeNull();
  });

  it("throws a 404 from getOrThrow", () => {
    expect(() => requests.getOrThrow("missing")).toThrow(/not found/);
  });
});

describe("transition", () => {
  it("moves along the machine and writes a status_changed event", () => {
    const request = create();
    ctx.clock.advance(SECOND);
    const queued = requests.transition(request.id, "queued", { actor: "system" });
    expect(queued.status).toBe("queued");
    expect(queued.updatedAt).toBe(ctx.clock.now().toISOString());
    expect(requests.events(request.id).map((e) => [e.type, e.payload])).toEqual([
      ["created", expect.anything()],
      ["status_changed", { from: "draft", to: "queued" }],
    ]);
  });

  it("writes the extra event after status_changed and applies the patch", () => {
    const request = create();
    requests.transition(request.id, "queued", { actor: "system" });
    const sentAt = ctx.clock.now().toISOString();
    const sent = requests.transition(request.id, "sent", {
      actor: "system",
      event: {
        type: "sent",
        payload: {
          channel: "email",
          kind: "initial",
          messageId: "<m@example.com>",
          mailboxId: "m1",
        },
      },
      patch: { sentAt, outgoingMessageId: "<m@example.com>", followUps: 0 },
    });
    expect(sent).toMatchObject({ status: "sent", sentAt, outgoingMessageId: "<m@example.com>" });
    expect(
      requests
        .events(request.id)
        .slice(-2)
        .map((e) => e.type),
    ).toEqual(["status_changed", "sent"]);
    expect(requests.events(request.id).at(-1)?.payload).toEqual({
      channel: "email",
      kind: "initial",
      messageId: "<m@example.com>",
      mailboxId: "m1",
    });
  });

  it("switches channel from awaiting_reply back to queued", () => {
    const request = create();
    for (const status of ["queued", "sent", "awaiting_reply"] as const) {
      requests.transition(request.id, status, { actor: "system" });
    }
    const switched = requests.transition(request.id, "queued", {
      actor: "system",
      event: {
        type: "channel_switched",
        payload: { from: "email", to: "form", reason: "needs_form" },
      },
      patch: { channel: "form" },
    });
    expect(switched).toMatchObject({ status: "queued", channel: "form" });
  });

  it("refuses a move the machine does not allow and changes nothing", () => {
    const request = create();
    expect(() =>
      requests.transition(request.id, "confirmed", { actor: "system", patch: { lastError: "x" } }),
    ).toThrow(/cannot move from draft to confirmed/);
    expect(requests.getOrThrow(request.id)).toMatchObject({ status: "draft", lastError: null });
    expect(requests.events(request.id)).toHaveLength(1);
  });

  it("lets only a user force an outcome", () => {
    const request = create();
    expect(() => requests.transition(request.id, "confirmed", { actor: "agent" })).toThrow();
    const forced = requests.transition(request.id, "confirmed", {
      actor: "user",
      event: { type: "user_action", payload: { action: "mark_confirmed", note: null } },
    });
    expect(forced.status).toBe("confirmed");
    expect(requests.events(request.id).at(-2)?.actor).toBe("user");
  });

  it("never leaves a terminal status", () => {
    const request = create();
    requests.transition(request.id, "cancelled", { actor: "user" });
    expect(() => requests.transition(request.id, "queued", { actor: "user" })).toThrow();
    expect(() => requests.transition(request.id, "confirmed", { actor: "user" })).toThrow();
  });

  it("ignores undefined patch values instead of clearing columns", () => {
    const request = create({ recordUrl: "https://x.test/p/1" });
    const moved = requests.transition(request.id, "queued", {
      actor: "system",
      patch: { recordUrl: undefined, lastError: "kept" },
    });
    expect(moved).toMatchObject({ recordUrl: "https://x.test/p/1", lastError: "kept" });
  });

  it("throws for a missing request", () => {
    expect(() => requests.transition("missing", "queued", { actor: "system" })).toThrow(
      /not found/,
    );
  });
});

describe("update and events", () => {
  it("changes fields without a status change or an event", () => {
    const request = create();
    ctx.clock.advance(SECOND);
    const updated = requests.update(request.id, { lastError: "smtp down", followUps: 1 });
    expect(updated).toMatchObject({
      status: "draft",
      lastError: "smtp down",
      followUps: 1,
      updatedAt: ctx.clock.now().toISOString(),
    });
    expect(requests.events(request.id)).toHaveLength(1);
  });

  it("can clear a nullable column explicitly", () => {
    const request = create();
    requests.update(request.id, { lastError: "x" });
    expect(requests.update(request.id, { lastError: null }).lastError).toBeNull();
  });

  it("adds events and lists them oldest first even within one instant", () => {
    const request = create();
    requests.addEvent(request.id, {
      type: "reply_received",
      actor: "system",
      payload: { messageId: "m1", from: "privacy@broker.test", subject: "Re: x" },
    });
    requests.addEvent(request.id, {
      type: "classified",
      actor: "system",
      payload: {
        messageId: "m1",
        classification: "completed",
        confidence: 0.9,
        correlation: "reference",
      },
    });
    requests.addEvent(request.id, {
      type: "note",
      actor: "user",
      payload: { text: "called them" },
    });
    const events = requests.events(request.id);
    expect(events.map((e) => e.type)).toEqual(["created", "reply_received", "classified", "note"]);
    expect(events[3]?.payload).toEqual({ text: "called them" });
    expect(() =>
      requests.addEvent("missing", { type: "note", actor: "user", payload: { text: "x" } }),
    ).toThrow(/not found/);
  });
});

describe("event payloads", () => {
  it("refuses a payload that is not what the event type carries, and writes nothing", () => {
    const request = create();
    expect(() =>
      requests.addEvent(request.id, {
        type: "note",
        actor: "user",
        payload: { body: "x" } as never,
      }),
    ).toThrow();
    expect(() =>
      requests.transition(request.id, "queued", {
        actor: "system",
        event: { type: "task_enqueued", payload: { taskId: "t" } as never },
      }),
    ).toThrow();
    expect(requests.getOrThrow(request.id).status).toBe("draft");
    expect(requests.events(request.id)).toHaveLength(1);
  });

  it("reads back what it wrote, typed by the event", () => {
    const request = create();
    requests.transition(request.id, "queued", { actor: "system" });
    const event = requests.events(request.id).at(-1);
    expect(event).toMatchObject({
      type: "status_changed",
      payload: { from: "draft", to: "queued" },
    });
  });
});

describe("waiting for a confirmation email", () => {
  function awaitingReply() {
    const request = create();
    for (const status of ["queued", "sent", "awaiting_reply"] as const) {
      requests.transition(request.id, status, { actor: "system" });
    }
    return request;
  }

  it("is set with the move to awaiting_reply and cleared by the next status change", () => {
    const request = create({ channel: "form" });
    requests.transition(request.id, "queued", { actor: "system" });
    const since = ctx.clock.now().toISOString();
    const waiting = requests.transition(request.id, "awaiting_reply", {
      actor: "worker",
      patch: { awaitingConfirmationSince: since },
      event: {
        type: "awaiting_confirmation",
        payload: { fromDomains: ["broker.test"], linkTextPattern: null },
      },
    });
    expect(waiting.awaitingConfirmationSince).toBe(since);
    const confirmed = requests.transition(request.id, "confirmed", { actor: "system" });
    expect(confirmed.awaitingConfirmationSince).toBeNull();
  });

  it("does not survive an unrelated status change", () => {
    const request = awaitingReply();
    requests.update(request.id, { awaitingConfirmationSince: ctx.clock.now().toISOString() });
    expect(
      requests.transition(request.id, "no_response", { actor: "system" }).awaitingConfirmationSince,
    ).toBeNull();
  });

  it("can only be set while the request is awaiting a reply", () => {
    const request = create();
    expect(() =>
      requests.update(request.id, { awaitingConfirmationSince: ctx.clock.now().toISOString() }),
    ).toThrow(expect.objectContaining({ code: "invalid_request_state" }));
    const waiting = awaitingReply();
    expect(
      requests.update(waiting.id, { awaitingConfirmationSince: ctx.clock.now().toISOString() })
        .awaitingConfirmationSince,
    ).not.toBeNull();
  });
});

describe("settling a request stops its tasks", () => {
  function queueSend(requestId: string) {
    return ctx.services.taskQueue.enqueue({
      kind: "email_send",
      payload: { requestId, kind: "initial", fields: [], inReplyTo: null },
      profileId,
      targetId,
      requestId,
    }).task;
  }

  it.each(["cancelled", "confirmed", "no_record", "rejected"] as const)(
    "cancels the live tasks when the request becomes %s",
    (status) => {
      const request = create();
      requests.transition(request.id, "queued", { actor: "system" });
      const task = queueSend(request.id);
      requests.transition(request.id, status, { actor: "user" });
      expect(ctx.services.taskQueue.getOrThrow(task.id).status).toBe("cancelled");
      expect(requests.events(request.id).map((e) => e.type)).toContain("task_cancelled");
    },
  );

  it("leaves the tasks of a request that is only moving along", () => {
    const request = create();
    requests.transition(request.id, "queued", { actor: "system" });
    const task = queueSend(request.id);
    requests.transition(request.id, "sent", { actor: "system" });
    expect(ctx.services.taskQueue.getOrThrow(task.id).status).toBe("queued");
  });

  it("does not touch the tasks of another request", () => {
    const request = create();
    const other = create();
    const task = queueSend(other.id);
    requests.transition(request.id, "cancelled", { actor: "user" });
    expect(ctx.services.taskQueue.getOrThrow(task.id).status).toBe("queued");
  });

  it("takes the task and the status change back together if the move is refused", () => {
    const request = create();
    const task = queueSend(request.id);
    expect(() => requests.transition(request.id, "confirmed", { actor: "agent" })).toThrow();
    expect(ctx.services.taskQueue.getOrThrow(task.id).status).toBe("queued");
  });
});
