import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jordanIdentities } from "../test-utils/builders.js";
import { FAKE_STATUTE } from "../test-utils/fake-legal.js";
import {
  createTestContext,
  seedIdentities,
  seedMailbox,
  seedProfile,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import type { ComposableRequest } from "./composer.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

function setup(state: "TX" | "CA" = "TX") {
  const profile = seedProfile(ctx, { state });
  const mailbox = seedMailbox(ctx, profile.id, { address: "mailbox@example.org" });
  const target = seedTarget(ctx, { name: "Example Broker", privacyEmail: "privacy@broker.test" });
  const request = seedRequest(ctx, {
    profileId: profile.id,
    targetId: target.id,
    rights: ["opt_out", "delete"],
    legalBasis: "policy",
    sentAt: ctx.clock.now().toISOString(),
  });
  return { profile, mailbox, target, request };
}

const compose = (
  request: ComposableRequest,
  kind: "initial" | "follow_up" | "verification_reply" = "initial",
  requestedFields?: Parameters<TestContext["services"]["composer"]["requestEmail"]>[2],
) => ctx.services.composer.requestEmail(request, kind, requestedFields);

describe("composer.requestEmail", () => {
  it("builds the email and the exact input it was rendered from", () => {
    const { request, mailbox } = setup();
    const composed = compose(request);
    expect(composed.to).toBe("privacy@broker.test");
    expect(composed.mailboxId).toBe(mailbox.id);
    expect(composed.input).toMatchObject({
      kind: "initial",
      rights: ["opt_out", "delete"],
      reference: request.reference,
      sender: { name: "Jordan Q Example", address: "mailbox@example.org" },
      target: { name: "Example Broker" },
      basis: { id: "policy", kind: "policy" },
    });
    expect(composed.email).toEqual(ctx.legal.renderRequestEmail(composed.input));
    expect(composed.email.subject).toContain(request.reference);
  });

  it("discloses only what the legal package allows for a blind email", () => {
    const { request } = setup();
    expect(Object.keys(compose(request).input.identifiers).sort()).toEqual(["email", "full_name"]);
  });

  it("sends from the mailbox of the request, and the sender is named after the primary name", () => {
    const { profile, request } = setup();
    seedIdentities(ctx, profile.id, [
      ...jordanIdentities().filter((i) => i.kind !== "name"),
      {
        kind: "name",
        value: { first: "Jo", last: "Sample" },
        isPrimary: true,
        validFrom: null,
        validTo: null,
      },
    ]);
    expect(compose(request).input.sender).toEqual({
      name: "Jo Sample",
      address: "mailbox@example.org",
    });
  });

  it("cites the statute the request was opened under, not today's best match", () => {
    const { request } = setup("CA");
    // The request was opened under the policy basis; a statute that now applies is not swapped in.
    expect(compose({ ...request, legalBasis: "policy" }).input.basis.id).toBe("policy");
    expect(compose({ ...request, legalBasis: FAKE_STATUTE.id }).input.basis).toMatchObject({
      id: FAKE_STATUTE.id,
      kind: "statute",
    });
  });

  it("falls back to resolving a basis when the stored id is not one the legal package knows", () => {
    const { request } = setup("CA");
    expect(compose({ ...request, legalBasis: "repealed-act" }).input.basis.id).toBe(
      FAKE_STATUTE.id,
    );
  });

  it("numbers a follow-up and says when the first request went out", () => {
    const { request } = setup();
    const composed = compose({ ...request, followUps: 1 }, "follow_up");
    expect(composed.input.followUp).toEqual({ number: 2, originalSentAt: request.sentAt });
    expect(composed.email.subject).toMatch(/^Follow-up:/);
  });

  it("refuses a follow-up for a request that never went out", () => {
    const { request } = setup();
    expect(() => compose({ ...request, sentAt: null }, "follow_up")).toThrow(
      expect.objectContaining({ code: "not_sent_yet" }),
    );
  });

  it("adds the approved fields to a verification reply, and only those", () => {
    const { request } = setup();
    const composed = compose(request, "verification_reply", { requestedFields: ["date_of_birth"] });
    expect(composed.input.verification).toEqual({ requestedFields: ["date_of_birth"] });
    expect(composed.input.identifiers.date_of_birth).toBe("1990-04-05");
    expect(composed.input.identifiers.street).toBeUndefined();
  });

  it("refuses a verification reply with no approved fields and fields on any other email", () => {
    const { request } = setup();
    expect(() => compose(request, "verification_reply")).toThrow(
      expect.objectContaining({ code: "verification_fields_required" }),
    );
    expect(() => compose(request, "initial", { requestedFields: ["street"] })).toThrow(
      expect.objectContaining({ code: "verification_fields_required" }),
    );
  });

  it("works for a request that does not exist yet, which is what a campaign preview needs", () => {
    const { profile, target } = setup();
    const preview = compose({
      profileId: profile.id,
      targetId: target.id,
      rights: ["opt_out"],
      legalBasis: "policy",
      reference: "KR-ABC234",
      sentAt: null,
      followUps: 0,
      mailboxId: null,
    });
    expect(preview.email.subject).toContain("KR-ABC234");
    expect(preview.input.sender.address).toBe("mailbox@example.org");
  });

  it("is the mail the preview and the runner share: the same request gives the same email", () => {
    const { request } = setup();
    expect(compose(request).email).toEqual(compose(request).email);
  });

  it("refuses when there is no mailbox or no address to write to", () => {
    const { request, target } = setup();
    const other = seedProfile(ctx);
    expect(() => compose({ ...request, profileId: other.id, mailboxId: null })).toThrow(
      expect.objectContaining({ code: "mailbox_required" }),
    );
    const noAddress = seedTarget(ctx, { privacyEmail: null, contactMethod: "form" });
    expect(() => compose({ ...request, targetId: noAddress.id })).toThrow(
      expect.objectContaining({ code: "no_email_address" }),
    );
    expect(target.id).toBeTruthy();
  });

  it("answers 404 for a profile or target that does not exist", () => {
    const { request } = setup();
    expect(() => compose({ ...request, profileId: "missing" })).toThrow(
      expect.objectContaining({ status: 404, code: "profile_not_found" }),
    );
    expect(() => compose({ ...request, targetId: "missing" })).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });
});
