import { requestEvents, requests } from "@kickrocks/db";
import type { ReplyClassification, RequestStatus } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  seedMailbox,
  seedProfile,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { applyReply } from "./reply.js";

let ctx: TestContext;
let profileId: string;
let targetId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  seedMailbox(ctx, profileId);
  targetId = seedTarget(ctx, {
    kind: "broker",
    id: "spokeo",
    name: "Spokeo",
    domain: "spokeo.test",
  }).id;
});

afterEach(async () => {
  await ctx.close();
});

function requestIn(status: RequestStatus) {
  const { request } = ctx.services.requests.open({
    profileId,
    targetId,
    rights: ["opt_out"],
    channel: "email",
    actor: "user",
  });
  ctx.services.db.update(requests).set({ status }).where(eq(requests.id, request.id)).run();
  return ctx.services.requests.getOrThrow(request.id);
}

function reply(
  request: ReturnType<typeof requestIn>,
  classification: ReplyClassification,
  requestedFields: string[] = [],
) {
  const outcome = applyReply(ctx.services, {
    request,
    messageId: "message-1",
    classification,
    confidence: 0.9,
    correlation: "reference",
    actor: "system",
    link: null,
    requestedFields,
  });
  const classified = ctx.services.db
    .select()
    .from(requestEvents)
    .where(eq(requestEvents.requestId, request.id))
    .all()
    .find((event) => event.type === "classified");
  return {
    outcome,
    status: ctx.services.requests.getOrThrow(request.id).status,
    late: (classified?.payload as { late?: boolean } | undefined)?.late,
  };
}

const ANSWERS: Array<[ReplyClassification, string[]]> = [
  ["completed", []],
  ["no_record", []],
  ["rejected", []],
  ["verification_required", ["dateOfBirth"]],
  ["needs_form", []],
  ["bounce", []],
];

describe("a reply to a request that is already over", () => {
  for (const status of ["confirmed", "no_record", "cancelled"] as const) {
    for (const [classification, fields] of ANSWERS) {
      if (classification === "completed" && status === "confirmed") continue;
      if (classification === "no_record" && status === "no_record") continue;
      if (classification === "verification_required") continue;
      it(`is recorded and handled when a ${classification} reply reaches a ${status} request`, () => {
        const result = reply(requestIn(status), classification, fields);

        expect(result.outcome.needsReview).toBe(false);
        expect(result.status).toBe(status);
        expect(result.late).toBe(true);
      });
    }
  }

  for (const status of ["confirmed", "no_record", "cancelled"] as const) {
    it(`records a request for identifying details on a ${status} request but leaves it for the person`, () => {
      const result = reply(requestIn(status), "verification_required", ["dateOfBirth"]);

      expect(result.outcome.needsReview).toBe(true);
      expect(result.status).toBe(status);
      expect(result.late).toBe(true);
    });

    it(`handles a verification reply that asks for nothing on a ${status} request`, () => {
      const result = reply(requestIn(status), "verification_required");

      expect(result.outcome.needsReview).toBe(false);
      expect(result.late).toBe(true);
    });
  }

  it("is not marked late when it says what the request already is", () => {
    const result = reply(requestIn("confirmed"), "completed");
    expect(result).toMatchObject({ outcome: { needsReview: false }, status: "confirmed" });
    expect(result.late).toBeUndefined();
  });

  it("still goes to a person when the classifier could not say what it is", () => {
    const result = reply(requestIn("confirmed"), "unknown");
    expect(result.outcome.needsReview).toBe(true);
    expect(result.late).toBeUndefined();
  });
});

describe("a reply the request's status cannot take, though the request is not over", () => {
  it.each([
    ["rejected", "verification_required"],
    ["bounced", "completed"],
    ["bounced", "no_record"],
  ] as const)("stays in Review when a %s request gets a %s reply", (status, classification) => {
    const result = reply(requestIn(status), classification, ["dateOfBirth"]);

    expect(result.outcome.needsReview).toBe(true);
    expect(result.status).toBe(status);
    expect(result.late).toBeUndefined();
  });

  it("moves a request that can take the reply", () => {
    const result = reply(requestIn("awaiting_reply"), "completed");
    expect(result).toMatchObject({ outcome: { needsReview: false }, status: "confirmed" });
  });
});
