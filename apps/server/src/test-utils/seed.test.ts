import { Broker, Company, Identity, Recipe } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jordanIdentities } from "./builders.js";
import { createTestContext, type TestContext } from "./context.js";
import {
  seedCampaign,
  seedIdentities,
  seedMailbox,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedTarget,
} from "./seed.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

describe("seedProfile and seedIdentities", () => {
  it("creates Jordan Example with one identity of each kind", () => {
    const profile = seedProfile(ctx);
    expect(profile).toMatchObject({
      displayName: "Jordan Example",
      state: "TX",
      createdAt: ctx.clock.now().toISOString(),
    });
    expect(profile.identities.map((i) => i.kind)).toEqual([
      "name",
      "email",
      "phone",
      "address",
      "dob",
    ]);
    for (const identity of profile.identities)
      expect(Identity.safeParse(identity).success).toBe(true);
  });

  it("takes overrides", () => {
    const profile = seedProfile(ctx, {
      displayName: "Sam Sample",
      state: "CA",
      identities: [
        {
          kind: "name",
          value: { first: "Sam", last: "Sample" },
          isPrimary: true,
          validFrom: null,
          validTo: null,
        },
        {
          kind: "email",
          value: { address: "sam@example.org" },
          isPrimary: true,
          validFrom: null,
          validTo: null,
        },
      ],
    });
    expect(profile).toMatchObject({ displayName: "Sam Sample", state: "CA" });
    expect(profile.identities).toHaveLength(2);
  });

  it("replaces a profile's identities as a unit", () => {
    const profile = seedProfile(ctx);
    const replaced = seedIdentities(ctx, profile.id, jordanIdentities().slice(0, 2));
    expect(replaced.map((i) => i.kind)).toEqual(["name", "email"]);
    expect(seedIdentities(ctx, profile.id)).toHaveLength(5);
  });
});

describe("seedMailbox", () => {
  it("creates a usable mailbox with fake credentials", () => {
    const profile = seedProfile(ctx);
    const mailbox = seedMailbox(ctx, profile.id, { dailyCap: 5 });
    expect(mailbox).toMatchObject({
      profileId: profile.id,
      dailyCap: 5,
      replyFolder: "INBOX",
      address: "jordan@example.com",
      smtpHost: "smtp.example.test",
    });
  });

  it("allows only one per profile", () => {
    const profile = seedProfile(ctx);
    seedMailbox(ctx, profile.id);
    expect(() => seedMailbox(ctx, profile.id)).toThrow(/UNIQUE/);
  });
});

describe("seedTarget", () => {
  it("creates a broker whose stored record is valid", () => {
    const row = seedTarget(ctx, {
      id: "spokeo",
      category: "people-search",
      requirements: ["record_url"],
      priority: "crucial",
    });
    expect(row).toMatchObject({
      id: "spokeo",
      kind: "broker",
      category: "people-search",
      priority: "crucial",
      retired: false,
      datasetVersion: "test",
    });
    expect(Broker.safeParse(row.data).success).toBe(true);
    expect(ctx.services.targets.summary("spokeo")).toMatchObject({ needsRecord: true });
  });

  it("creates a company", () => {
    const row = seedTarget(ctx, { kind: "company", id: "shop", category: "retail" });
    expect(row).toMatchObject({ kind: "company", category: "retail", region: "us" });
    expect(Company.safeParse(row.data).success).toBe(true);
  });

  it("creates several without colliding", () => {
    expect(() => {
      seedTarget(ctx);
      seedTarget(ctx);
      seedTarget(ctx, { kind: "company" });
    }).not.toThrow();
  });
});

describe("seedRecipe", () => {
  it("creates an active remove recipe by default", () => {
    const target = seedTarget(ctx, { id: "spokeo" });
    const row = seedRecipe(ctx, target.id);
    expect(row).toMatchObject({
      id: "spokeo.remove.v1",
      targetId: "spokeo",
      purpose: "remove",
      version: 1,
      status: "active",
      health: "unknown",
      source: "bundled",
      failureCount: 0,
    });
    expect(Recipe.safeParse(row.definition).success).toBe(true);
  });

  it("takes purpose, version, state, and definition overrides", () => {
    const target = seedTarget(ctx, { id: "spokeo" });
    const row = seedRecipe(ctx, target.id, {
      purpose: "scan",
      version: 4,
      status: "pending_review",
      health: "broken",
      source: "proposed",
      failureCount: 3,
      definition: { notes: "hello" },
    });
    expect(row).toMatchObject({
      id: "spokeo.scan.v4",
      status: "pending_review",
      health: "broken",
      source: "proposed",
      failureCount: 3,
    });
    expect(row.definition.notes).toBe("hello");
  });
});

describe("seedRequest", () => {
  it("creates a draft email request by default, with a reference and a created event", () => {
    const profile = seedProfile(ctx);
    const target = seedTarget(ctx);
    const request = seedRequest(ctx, { profileId: profile.id, targetId: target.id });
    expect(request).toMatchObject({
      status: "draft",
      channel: "email",
      rights: ["opt_out"],
      legalBasis: "policy",
    });
    expect(request.reference).toMatch(/^KR-[0-9A-Z]{6}$/);
    expect(ctx.services.requests.events(request.id).map((e) => e.type)).toEqual(["created"]);
  });

  it("starts from any status without walking the machine", () => {
    const profile = seedProfile(ctx);
    const target = seedTarget(ctx);
    const sentAt = ctx.clock.now().toISOString();
    const request = seedRequest(ctx, {
      profileId: profile.id,
      targetId: target.id,
      status: "awaiting_reply",
      channel: "form",
      rights: ["opt_out", "delete"],
      legalBasis: "ca-test-act",
      recordUrl: "https://x.test/p/1",
      sentAt,
      followUps: 1,
    });
    expect(request).toMatchObject({
      status: "awaiting_reply",
      channel: "form",
      rights: ["opt_out", "delete"],
      legalBasis: "ca-test-act",
      recordUrl: "https://x.test/p/1",
      sentAt,
      followUps: 1,
    });
    expect(ctx.services.requests.getOrThrow(request.id).status).toBe("awaiting_reply");
  });

  it("attaches a campaign", () => {
    const profile = seedProfile(ctx);
    const target = seedTarget(ctx);
    const campaign = seedCampaign(ctx, profile.id);
    expect(
      seedRequest(ctx, { profileId: profile.id, targetId: target.id, campaignId: campaign.id })
        .campaignId,
    ).toBe(campaign.id);
  });
});
