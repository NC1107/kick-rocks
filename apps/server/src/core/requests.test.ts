import { Reference } from "@kickrocks/shared";
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

  it("rejects a profile or target that does not exist", () => {
    expect(() => create({ profileId: "missing" })).toThrow(/FOREIGN KEY/);
    expect(() => create({ targetId: "missing" })).toThrow(/FOREIGN KEY/);
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
      eventType: "sent",
      payload: { messageId: "<m@example.com>" },
      patch: { sentAt, outgoingMessageId: "<m@example.com>", followUps: 0 },
    });
    expect(sent).toMatchObject({ status: "sent", sentAt, outgoingMessageId: "<m@example.com>" });
    expect(
      requests
        .events(request.id)
        .slice(-2)
        .map((e) => e.type),
    ).toEqual(["status_changed", "sent"]);
    expect(requests.events(request.id).at(-1)?.payload).toEqual({ messageId: "<m@example.com>" });
  });

  it("switches channel from awaiting_reply back to queued", () => {
    const request = create();
    for (const status of ["queued", "sent", "awaiting_reply"] as const) {
      requests.transition(request.id, status, { actor: "system" });
    }
    const switched = requests.transition(request.id, "queued", {
      actor: "system",
      eventType: "channel_switched",
      payload: { from: "email", to: "form" },
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
      eventType: "user_action",
      payload: { action: "mark_confirmed" },
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
    requests.addEvent(request.id, { type: "reply_received", actor: "system", payload: { n: 1 } });
    requests.addEvent(request.id, { type: "classified", actor: "system" });
    requests.addEvent(request.id, {
      type: "note",
      actor: "user",
      payload: { text: "called them" },
    });
    const events = requests.events(request.id);
    expect(events.map((e) => e.type)).toEqual(["created", "reply_received", "classified", "note"]);
    expect(events[2]?.payload).toBeNull();
    expect(() => requests.addEvent("missing", { type: "note", actor: "user" })).toThrow(
      /not found/,
    );
  });
});
