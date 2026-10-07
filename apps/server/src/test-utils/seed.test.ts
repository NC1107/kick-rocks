import { Broker, Company, Identity, Recipe } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jordanIdentities } from "./builders.js";
import { createTestContext, type TestContext } from "./context.js";
import {
  leaseAs,
  seedCampaign,
  seedIdentities,
  seedMailbox,
  seedMatch,
  seedMessage,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedScan,
  seedTarget,
  seedTask,
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

describe("seedMessage", () => {
  it("is an unreviewed, unclassified message waiting in the review queue", () => {
    const profile = seedProfile(ctx);
    const mailbox = seedMailbox(ctx, profile.id);
    const message = seedMessage(ctx, { mailboxId: mailbox.id });
    expect(message).toMatchObject({
      mailboxId: mailbox.id,
      requestId: null,
      classification: "unknown",
      confidence: 0,
      links: [],
      requestedFields: [],
      text: null,
      reviewed: false,
      receivedAt: ctx.clock.now().toISOString(),
    });
  });

  it("takes what a test cares about and gives every message its own uid", () => {
    const profile = seedProfile(ctx);
    const mailbox = seedMailbox(ctx, profile.id);
    const a = seedMessage(ctx, {
      mailboxId: mailbox.id,
      classification: "verification_required",
      confidence: 0.9,
      requestedFields: ["date_of_birth"],
      links: ["https://broker.test/verify"],
      text: "Please send your date of birth.",
    });
    const b = seedMessage(ctx, { mailboxId: mailbox.id });
    expect(a).toMatchObject({
      classification: "verification_required",
      requestedFields: ["date_of_birth"],
      text: "Please send your date of birth.",
    });
    expect(a.imapUid).not.toBe(b.imapUid);
  });
});

describe("seedScan and seedMatch", () => {
  it("makes a running scan with a pending match to decide", () => {
    const profile = seedProfile(ctx);
    const target = seedTarget(ctx, { category: "people-search" });
    const scan = seedScan(ctx, { profileId: profile.id, targetId: target.id });
    expect(scan).toMatchObject({ finishedAt: null, candidates: null, error: null, taskId: null });
    const match = seedMatch(ctx, { scanId: scan.id, profileId: profile.id, targetId: target.id });
    expect(match).toMatchObject({ decision: "pending", decidedAt: null, requestId: null });
    expect(match.recordUrl).toMatch(/^https:\/\/records\.test\/p\/\d+$/);
  });

  it("stamps a decision it is given", () => {
    const profile = seedProfile(ctx);
    const target = seedTarget(ctx);
    const scan = seedScan(ctx, { profileId: profile.id, targetId: target.id });
    const match = seedMatch(ctx, {
      scanId: scan.id,
      profileId: profile.id,
      targetId: target.id,
      decision: "mine",
    });
    expect(match.decidedAt).toBe(ctx.clock.now().toISOString());
  });
});

describe("seedTask and leaseAs", () => {
  const payload = { requestId: "r", url: "https://x.test/c" };

  it("makes a queued task by default, validated like the queue would", () => {
    const task = seedTask(ctx, { kind: "confirm", payload });
    expect(task).toMatchObject({
      kind: "confirm",
      status: "queued",
      attempts: 0,
      leaseOwner: null,
    });
    expect(() =>
      seedTask(ctx, { kind: "confirm", payload: { requestId: "r" } as never }),
    ).toThrow();
  });

  it("makes a leased task held by a worker until a time from the fake clock", () => {
    const task = seedTask(ctx, { kind: "confirm", payload, status: "leased" });
    expect(task).toMatchObject({
      status: "leased",
      leaseOwner: "seed-worker",
      attempts: 1,
      leaseExpiresAt: new Date(ctx.clock.now().getTime() + 300_000).toISOString(),
    });
  });

  it("makes a blocked task with a reason, a page, and a screenshot", () => {
    const task = seedTask(ctx, {
      kind: "confirm",
      payload,
      status: "blocked",
      blockedReason: "phone_verification",
      blockedDetail: "The site texts a code",
      blockedUrl: "https://x.test/verify",
      screenshot: true,
    });
    expect(task).toMatchObject({
      status: "blocked",
      blockedReason: "phone_verification",
      blockedUrl: "https://x.test/verify",
    });
    expect(ctx.services.taskQueue.screenshot(task.id)?.mime).toBe("image/png");
    expect(ctx.services.taskQueue.summarize([task])[0]?.hasScreenshot).toBe(true);
  });

  it("makes failed and done tasks with what a test needs to read", () => {
    const failed = seedTask(ctx, {
      kind: "confirm",
      payload,
      status: "failed",
      lastError: "boom",
      failureKind: "recipe",
    });
    expect(failed).toMatchObject({ status: "failed", lastError: "boom", failureKind: "recipe" });
    const done = seedTask(ctx, {
      kind: "confirm",
      payload,
      status: "done",
      result: { confirmed: true, finalUrl: "https://x.test/ok" },
    });
    expect(done.result).toEqual({ confirmed: true, finalUrl: "https://x.test/ok" });
  });

  it("writes no event and runs no handler, so a test starts from exactly the state it asked for", () => {
    const profile = seedProfile(ctx);
    const target = seedTarget(ctx);
    const request = seedRequest(ctx, { profileId: profile.id, targetId: target.id });
    let seen = 0;
    ctx.services.taskHandlers.on("confirm", ["blocked", "completed", "failed"], () => void seen++);
    seedTask(ctx, { kind: "confirm", payload, status: "blocked", requestId: request.id });
    expect(seen).toBe(0);
    expect(ctx.services.requests.events(request.id).map((e) => e.type)).toEqual(["created"]);
  });

  it("leases a queued task to a worker through the real queue", () => {
    const task = seedTask(ctx, { kind: "confirm", payload });
    const leased = leaseAs(ctx, task.id, "worker-9");
    expect(leased).toMatchObject({ status: "leased", leaseOwner: "worker-9", attempts: 1 });
    expect(() => leaseAs(ctx, task.id, "worker-10")).toThrow(/cannot be leased/);
  });
});
