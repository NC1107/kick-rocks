import { recipes, scans, targets, tasks } from "@kickrocks/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jordanIdentities } from "../test-utils/builders.js";
import {
  createTestContext,
  seedIdentities,
  seedMailbox,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedTarget,
  seedTask,
  type TestContext,
} from "../test-utils/index.js";

let ctx: TestContext;
let profileId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
});

afterEach(async () => {
  await ctx.close();
});

const queuedRequest = (
  targetId: string,
  overrides: Partial<Parameters<typeof seedRequest>[1]> = {},
) => seedRequest(ctx, { profileId, targetId, status: "queued", ...overrides });

const dispatch = () => ctx.services.dispatch;

describe("dispatchRequest for email", () => {
  beforeEach(() => {
    seedMailbox(ctx, profileId);
  });

  it("queues an email_send task and records a task_enqueued event", () => {
    const target = seedTarget(ctx);
    const request = queuedRequest(target.id);
    const { task, created } = dispatch().dispatchRequest(request.id);
    expect(created).toBe(true);
    expect(task).toMatchObject({
      kind: "email_send",
      status: "queued",
      payload: { requestId: request.id, kind: "initial", fields: [], inReplyTo: null },
      profileId,
      targetId: target.id,
      requestId: request.id,
      dedupeKey: `email_send:${request.id}`,
    });
    const events = ctx.services.requests.events(request.id);
    expect(events.at(-1)).toMatchObject({
      type: "task_enqueued",
      actor: "system",
      payload: { taskId: task.id, kind: "email_send" },
    });
  });

  it("does not queue the same request twice while a task is live", () => {
    const request = queuedRequest(seedTarget(ctx).id);
    const first = dispatch().dispatchRequest(request.id);
    const second = dispatch().dispatchRequest(request.id);
    expect(second.created).toBe(false);
    expect(second.task.id).toBe(first.task.id);
    expect(
      ctx.services.requests.events(request.id).filter((e) => e.type === "task_enqueued"),
    ).toHaveLength(1);
  });

  it("sends the kind it is told, never one it guesses from whether the request went out before", () => {
    const sent = { sentAt: ctx.clock.now().toISOString() };
    const bounced = queuedRequest(seedTarget(ctx).id, sent);
    expect(dispatch().dispatchRequest(bounced.id).task.payload).toMatchObject({ kind: "initial" });
    const followUp = queuedRequest(seedTarget(ctx).id, sent);
    expect(
      dispatch().dispatchRequest(followUp.id, { kind: "follow_up" }).task.payload,
    ).toMatchObject({
      kind: "follow_up",
    });
  });

  it("sends a verification reply with the approved fields and the message it answers", () => {
    const request = queuedRequest(seedTarget(ctx).id, { sentAt: ctx.clock.now().toISOString() });
    const { task } = dispatch().dispatchRequest(request.id, {
      kind: "verification_reply",
      fields: ["date_of_birth", "street"],
      inReplyTo: "<ask@broker.test>",
    });
    expect(task.payload).toEqual({
      requestId: request.id,
      kind: "verification_reply",
      fields: ["date_of_birth", "street"],
      inReplyTo: "<ask@broker.test>",
    });
  });

  it("refuses a verification reply with no fields and fields on any other kind", () => {
    const a = queuedRequest(seedTarget(ctx).id);
    expect(() => dispatch().dispatchRequest(a.id, { kind: "verification_reply" })).toThrow(
      expect.objectContaining({ code: "verification_fields_required" }),
    );
    expect(() => dispatch().dispatchRequest(a.id, { kind: "initial", fields: ["street"] })).toThrow(
      expect.objectContaining({ code: "verification_fields_required" }),
    );
    expect(ctx.services.taskQueue.list()).toEqual([]);
  });

  it("refuses a request that is not queued, reading its status from the database", () => {
    const request = seedRequest(ctx, { profileId, targetId: seedTarget(ctx).id, status: "draft" });
    expect(() => dispatch().dispatchRequest(request.id)).toThrow(
      /Only a queued request can be dispatched/,
    );
    expect(ctx.services.taskQueue.list()).toEqual([]);
  });

  it("does not trust a stale copy: a request cancelled since is refused", () => {
    const request = queuedRequest(seedTarget(ctx).id);
    ctx.services.requests.transition(request.id, "cancelled", { actor: "user" });
    expect(() => dispatch().dispatchRequest(request.id)).toThrow(/this one is cancelled/);
    expect(ctx.services.taskQueue.list()).toEqual([]);
  });

  it("needs a mailbox, and a target with an address to write to", () => {
    const other = seedProfile(ctx);
    const noMailbox = seedRequest(ctx, {
      profileId: other.id,
      targetId: seedTarget(ctx).id,
      status: "queued",
    });
    expect(() => dispatch().dispatchRequest(noMailbox.id)).toThrow(
      expect.objectContaining({ code: "mailbox_required" }),
    );
    const noAddress = queuedRequest(
      seedTarget(ctx, { privacyEmail: null, contactMethod: "form" }).id,
    );
    expect(() => dispatch().dispatchRequest(noAddress.id)).toThrow(
      expect.objectContaining({ code: "no_email_address" }),
    );
  });

  it("refuses a target that has left the dataset", () => {
    const target = seedTarget(ctx);
    const request = queuedRequest(target.id);
    ctx.services.db.update(targets).set({ retired: true }).where(eq(targets.id, target.id)).run();
    expect(() => dispatch().dispatchRequest(request.id)).toThrow(
      expect.objectContaining({ status: 409, code: "target_retired" }),
    );
    expect(ctx.services.taskQueue.list()).toEqual([]);
  });
});

describe("dispatchRequest for forms", () => {
  const formRequest = (
    targetId: string,
    overrides: Partial<Parameters<typeof seedRequest>[1]> = {},
  ) => queuedRequest(targetId, { channel: "form", ...overrides });

  it("queues a form task with the active remove recipe", () => {
    const target = seedTarget(ctx, { contactMethod: "form" });
    const recipe = seedRecipe(ctx, target.id, { purpose: "remove", version: 1 });
    seedMailbox(ctx, profileId);
    const request = formRequest(target.id, { recordUrl: "https://x.test/p/1" });
    const { task } = dispatch().dispatchRequest(request.id);
    expect(task).toMatchObject({
      kind: "form",
      payload: {
        requestId: request.id,
        targetId: target.id,
        recipeId: recipe.id,
        recordUrl: "https://x.test/p/1",
      },
      dedupeKey: `form:${request.id}`,
    });
  });

  it("prefers the newest active version", () => {
    const target = seedTarget(ctx);
    seedMailbox(ctx, profileId);
    seedRecipe(ctx, target.id, { version: 1 });
    const newest = seedRecipe(ctx, target.id, { version: 3 });
    seedRecipe(ctx, target.id, { version: 2 });
    const { task } = dispatch().dispatchRequest(formRequest(target.id).id);
    expect(task.payload).toMatchObject({ recipeId: newest.id });
  });

  it.each(["pending_review", "rejected", "retired"] as const)(
    "ignores a %s recipe and falls back to an agent",
    (status) => {
      const target = seedTarget(ctx);
      seedRecipe(ctx, target.id, { status });
      const request = formRequest(target.id);
      const { task } = dispatch().dispatchRequest(request.id);
      expect(task).toMatchObject({
        kind: "agent",
        payload: {
          purpose: "remove",
          profileId,
          targetId: target.id,
          requestId: request.id,
          recordUrl: null,
          variant: null,
          reason: "no_recipe",
          previousError: null,
          blockedReason: null,
        },
      });
    },
  );

  it("ignores a scan recipe when removing", () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { purpose: "scan" });
    expect(dispatch().dispatchRequest(formRequest(target.id).id).task.kind).toBe("agent");
  });

  describe("a recipe that is marked broken", () => {
    it("is not given new work: an agent takes it, for the right reason", () => {
      const target = seedTarget(ctx);
      seedMailbox(ctx, profileId);
      seedRecipe(ctx, target.id, { health: "broken" });
      const { task } = dispatch().dispatchRequest(formRequest(target.id).id);
      expect(task).toMatchObject({
        kind: "agent",
        payload: { reason: "recipe_failed", previousError: expect.stringMatching(/marked broken/) },
      });
    });

    it("lets an older version that is not broken run", () => {
      const target = seedTarget(ctx);
      seedMailbox(ctx, profileId);
      const healthy = seedRecipe(ctx, target.id, { version: 1, health: "healthy" });
      seedRecipe(ctx, target.id, { version: 2, health: "broken" });
      const { task } = dispatch().dispatchRequest(formRequest(target.id).id);
      expect(task).toMatchObject({ kind: "form", payload: { recipeId: healthy.id } });
    });

    it("sends a scan to an agent too", () => {
      const target = seedTarget(ctx);
      seedRecipe(ctx, target.id, { purpose: "scan", health: "broken" });
      expect(dispatch().enqueueScan(profileId, target.id).task).toMatchObject({
        kind: "agent",
        payload: { purpose: "scan", reason: "recipe_failed" },
      });
    });
  });

  it("requires a record url for a target that removes a specific record", () => {
    const target = seedTarget(ctx, { category: "people-search", requirements: ["record_url"] });
    seedMailbox(ctx, profileId);
    expect(() => dispatch().dispatchRequest(formRequest(target.id).id)).toThrow(
      /needs a record URL/,
    );
    expect(
      dispatch().dispatchRequest(formRequest(target.id, { recordUrl: "https://x.test/p/1" }).id)
        .created,
    ).toBe(true);
  });

  it("does not queue a second task for the same form request", () => {
    const target = seedTarget(ctx);
    const request = formRequest(target.id);
    dispatch().dispatchRequest(request.id);
    expect(dispatch().dispatchRequest(request.id).created).toBe(false);
  });

  describe("the form is filled in with the mailbox address", () => {
    it("needs a mailbox when the recipe types an email", () => {
      const target = seedTarget(ctx);
      seedRecipe(ctx, target.id, { definition: { fields: ["record_url", "email"] } });
      const request = formRequest(target.id, { recordUrl: "https://x.test/p/1" });
      expect(() => dispatch().dispatchRequest(request.id)).toThrow(
        expect.objectContaining({ code: "mailbox_required" }),
      );
      expect(ctx.services.taskQueue.list()).toEqual([]);
    });

    it("needs a mailbox when the target confirms by email, whatever the recipe says", () => {
      const target = seedTarget(ctx, { requirements: ["email_confirmation"] });
      expect(() => dispatch().dispatchRequest(formRequest(target.id).id)).toThrow(
        expect.objectContaining({ code: "mailbox_required" }),
      );
    });

    it("does not need one when nothing in the flow touches email", () => {
      const target = seedTarget(ctx);
      seedRecipe(ctx, target.id, {
        definition: {
          fields: ["first_name"],
          steps: [
            { kind: "goto", url: "https://x.test/optout" },
            { kind: "fill", target: { label: "Name" }, field: "first_name" },
          ],
        },
      });
      expect(dispatch().dispatchRequest(formRequest(target.id).id).created).toBe(true);
    });
  });
});

describe("enqueueScan", () => {
  it("queues a scan task with the active scan recipe and a scans row", () => {
    const target = seedTarget(ctx, { category: "people-search", requirements: ["record_url"] });
    const recipe = seedRecipe(ctx, target.id, { purpose: "scan" });
    const result = dispatch().enqueueScan(profileId, target.id);
    expect(result.created).toBe(true);
    expect(result.task).toMatchObject({
      kind: "scan",
      payload: { profileId, targetId: target.id, recipeId: recipe.id, variant: null },
      profileId,
      targetId: target.id,
      dedupeKey: `scan:${profileId}:${target.id}`,
    });
    const row = ctx.services.db
      .select()
      .from(scans)
      .where(eq(scans.id, result.scanId ?? ""))
      .get();
    expect(row).toMatchObject({
      profileId,
      targetId: target.id,
      taskId: result.task.id,
      startedAt: ctx.clock.now().toISOString(),
      finishedAt: null,
      candidates: null,
      error: null,
    });
  });

  it("falls back to an agent scan task without a recipe", () => {
    const target = seedTarget(ctx);
    const { task } = dispatch().enqueueScan(profileId, target.id);
    expect(task).toMatchObject({
      kind: "agent",
      payload: {
        purpose: "scan",
        profileId,
        targetId: target.id,
        requestId: null,
        recordUrl: null,
        variant: null,
        reason: "no_recipe",
        previousError: null,
        blockedReason: null,
      },
    });
  });

  it("ignores a remove recipe when scanning", () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { purpose: "remove" });
    expect(dispatch().enqueueScan(profileId, target.id).task.kind).toBe("agent");
  });

  it("returns the live scan instead of starting another", () => {
    const target = seedTarget(ctx);
    const first = dispatch().enqueueScan(profileId, target.id);
    const second = dispatch().enqueueScan(profileId, target.id);
    expect(second).toMatchObject({ created: false, scanId: first.scanId });
    expect(second.task.id).toBe(first.task.id);
    expect(ctx.services.db.select().from(scans).all()).toHaveLength(1);
  });

  it("starts a fresh scan once the earlier one finished", () => {
    const target = seedTarget(ctx);
    const first = dispatch().enqueueScan(profileId, target.id);
    ctx.services.taskQueue.claim({
      workerId: "w",
      kinds: ["agent"],
      leaseMs: 60_000,
      claimerKind: "mcp",
    });
    ctx.services.taskQueue.complete(first.task.id, {
      workerId: "w",
      result: { purpose: "scan", scan: { candidates: [] } },
      actor: "agent",
    });
    const second = dispatch().enqueueScan(profileId, target.id);
    expect(second.created).toBe(true);
    expect(second.scanId).not.toBe(first.scanId);
  });

  it("scans different profiles and targets independently", () => {
    const other = seedProfile(ctx);
    const a = seedTarget(ctx);
    const b = seedTarget(ctx);
    const results = [
      dispatch().enqueueScan(profileId, a.id),
      dispatch().enqueueScan(profileId, b.id),
      dispatch().enqueueScan(other.id, a.id),
    ];
    expect(results.every((r) => r.created)).toBe(true);
  });

  it("answers an unknown target or profile with a 404 and leaves nothing behind", () => {
    expect(() => dispatch().enqueueScan(profileId, "missing")).toThrow(
      expect.objectContaining({ status: 404, code: "target_not_found" }),
    );
    expect(() => dispatch().enqueueScan("no-such-profile", seedTarget(ctx).id)).toThrow(
      expect.objectContaining({ status: 404, code: "profile_not_found" }),
    );
    expect(ctx.services.db.select().from(tasks).all()).toEqual([]);
    expect(ctx.services.db.select().from(scans).all()).toEqual([]);
  });

  it("refuses a target that has left the dataset", () => {
    const target = seedTarget(ctx);
    ctx.services.db.update(targets).set({ retired: true }).where(eq(targets.id, target.id)).run();
    expect(() => dispatch().enqueueScan(profileId, target.id)).toThrow(
      expect.objectContaining({ status: 409, code: "target_retired" }),
    );
    expect(ctx.services.db.select().from(tasks).all()).toEqual([]);
  });

  describe("under a past name or address", () => {
    const withAlias = () => {
      const identities = [
        ...jordanIdentities(),
        {
          kind: "alias" as const,
          value: { first: "Jo", last: "Example" },
          isPrimary: false,
          validFrom: null,
          validTo: null,
        },
        {
          kind: "address" as const,
          value: { street: "9 Old Rd", city: "Dallas", state: "TX" as const, zip: "75001" },
          isPrimary: false,
          validFrom: null,
          validTo: "2020-12-31",
        },
      ];
      const saved = seedIdentities(ctx, profileId, identities);
      return {
        aliasId: saved.find((i) => i.kind === "alias")?.id ?? "",
        oldAddressId: saved.filter((i) => i.kind === "address").find((i) => i.validTo)?.id ?? "",
        nameId: saved.find((i) => i.kind === "name")?.id ?? "",
      };
    };

    it("keeps the variant in the payload and in the dedupe key, so each is its own scan", () => {
      const { aliasId, oldAddressId } = withAlias();
      const target = seedTarget(ctx);
      const current = dispatch().enqueueScan(profileId, target.id);
      const asAlias = dispatch().enqueueScan(profileId, target.id, {
        nameId: aliasId,
        addressId: null,
      });
      const oldHome = dispatch().enqueueScan(profileId, target.id, {
        nameId: null,
        addressId: oldAddressId,
      });
      expect([current, asAlias, oldHome].every((r) => r.created)).toBe(true);
      expect(new Set([current, asAlias, oldHome].map((r) => r.task.dedupeKey)).size).toBe(3);
      expect(asAlias.task.payload).toMatchObject({ variant: { nameId: aliasId, addressId: null } });
      expect(
        dispatch().enqueueScan(profileId, target.id, { nameId: aliasId, addressId: null }).created,
      ).toBe(false);
    });

    it("carries the variant to an agent", () => {
      const { aliasId } = withAlias();
      const target = seedTarget(ctx);
      const { task } = dispatch().enqueueScan(profileId, target.id, {
        nameId: aliasId,
        addressId: null,
      });
      expect(task).toMatchObject({
        kind: "agent",
        payload: { purpose: "scan", variant: { nameId: aliasId, addressId: null } },
      });
    });

    it("refuses an identity that is not the profile's or is the wrong kind", () => {
      const { nameId, oldAddressId } = withAlias();
      const target = seedTarget(ctx);
      for (const variant of [
        { nameId: "nobody", addressId: null },
        { nameId: oldAddressId, addressId: null },
        { nameId: null, addressId: nameId },
      ]) {
        expect(() => dispatch().enqueueScan(profileId, target.id, variant)).toThrow(
          expect.objectContaining({ status: 404, code: "identity_not_found" }),
        );
      }
      expect(ctx.services.db.select().from(tasks).all()).toEqual([]);
    });
  });
});

describe("one dedupe key names the work, whatever kind of task does it", () => {
  it("returns the live agent removal after a recipe is approved, instead of failing", () => {
    const target = seedTarget(ctx);
    seedMailbox(ctx, profileId);
    const request = queuedRequest(target.id, { channel: "form" });
    const agent = dispatch().dispatchRequest(request.id);
    expect(agent.task.kind).toBe("agent");
    seedRecipe(ctx, target.id, { purpose: "remove" });
    const again = dispatch().dispatchRequest(request.id);
    expect(again).toMatchObject({ created: false });
    expect(again.task.id).toBe(agent.task.id);
    expect(ctx.services.taskQueue.list({ requestId: request.id })).toHaveLength(1);
  });

  it("returns the live agent removal when it is blocked, too", () => {
    const target = seedTarget(ctx);
    seedMailbox(ctx, profileId);
    const request = queuedRequest(target.id, { channel: "form" });
    const agent = dispatch().dispatchRequest(request.id);
    ctx.services.taskQueue.claim({
      workerId: "w",
      kinds: ["agent"],
      leaseMs: 60_000,
      claimerKind: "mcp",
    });
    ctx.services.taskQueue.block(agent.task.id, {
      workerId: "w",
      reason: "captcha",
      actor: "agent",
    });
    seedRecipe(ctx, target.id, { purpose: "remove" });
    expect(dispatch().dispatchRequest(request.id).task.id).toBe(agent.task.id);
  });

  it("returns the live agent scan after a recipe is approved", () => {
    const target = seedTarget(ctx);
    const agent = dispatch().enqueueScan(profileId, target.id);
    seedRecipe(ctx, target.id, { purpose: "scan" });
    const again = dispatch().enqueueScan(profileId, target.id);
    expect(again).toMatchObject({ created: false, scanId: agent.scanId });
    expect(again.task.id).toBe(agent.task.id);
  });

  it("returns the live recipe scan if the recipe is retired while it waits", () => {
    const target = seedTarget(ctx);
    const recipe = seedRecipe(ctx, target.id, { purpose: "scan" });
    const first = dispatch().enqueueScan(profileId, target.id);
    ctx.services.db
      .update(recipes)
      .set({ status: "retired" })
      .where(eq(recipes.id, recipe.id))
      .run();
    expect(dispatch().enqueueScan(profileId, target.id).task.id).toBe(first.task.id);
  });
});

describe("fallbackToAgent", () => {
  it("replaces a failed scan with an agent task under the same key and repoints the scan row", () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { purpose: "scan" });
    const scan = dispatch().enqueueScan(profileId, target.id);
    ctx.services.taskQueue.claim({ workerId: "w", kinds: ["scan"], leaseMs: 60_000 });
    const failed = ctx.services.taskQueue.fail(scan.task.id, {
      workerId: "w",
      error: "selector gone",
      retryable: false,
      kind: "recipe",
      step: 1,
      actor: "worker",
    });
    const result = dispatch().fallbackToAgent(failed as never, {
      reason: "recipe_failed",
      error: "selector gone",
    });
    expect(result.task).toMatchObject({
      kind: "agent",
      dedupeKey: scan.task.dedupeKey,
      payload: {
        purpose: "scan",
        reason: "recipe_failed",
        previousError: "selector gone",
        blockedReason: null,
      },
    });
    const row = ctx.services.db
      .select()
      .from(scans)
      .where(eq(scans.id, scan.scanId ?? ""))
      .get();
    expect(row?.taskId).toBe(result.task.id);
    expect(dispatch().enqueueScan(profileId, target.id).task.id).toBe(result.task.id);
  });

  it("replaces a failed form with an agent removal for the same request", () => {
    const target = seedTarget(ctx);
    seedMailbox(ctx, profileId);
    seedRecipe(ctx, target.id, { purpose: "remove" });
    const request = queuedRequest(target.id, { channel: "form", recordUrl: "https://x.test/p/1" });
    const form = dispatch().dispatchRequest(request.id);
    ctx.services.taskQueue.claim({ workerId: "w", kinds: ["form"], leaseMs: 60_000 });
    const failed = ctx.services.taskQueue.fail(form.task.id, {
      workerId: "w",
      error: "expect_text failed",
      retryable: false,
      kind: "recipe",
      actor: "worker",
    });
    const result = dispatch().fallbackToAgent(failed as never, {
      reason: "recipe_failed",
      error: "expect_text failed",
    });
    expect(result.task).toMatchObject({
      kind: "agent",
      requestId: request.id,
      dedupeKey: `form:${request.id}`,
      payload: {
        purpose: "remove",
        requestId: request.id,
        recordUrl: "https://x.test/p/1",
        reason: "recipe_failed",
      },
    });
    expect(
      ctx.services.requests.events(request.id).filter((e) => e.type === "task_enqueued"),
    ).toHaveLength(2);
  });

  it("cancels the task first when it is still live", () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { purpose: "scan" });
    const scan = dispatch().enqueueScan(profileId, target.id);
    const result = dispatch().fallbackToAgent(scan.task as never, {
      reason: "no_recipe",
      error: null,
    });
    expect(ctx.services.taskQueue.getOrThrow(scan.task.id).status).toBe("cancelled");
    expect(result.task.kind).toBe("agent");
  });
});

describe("handToAgent", () => {
  function blockedScan() {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { purpose: "scan" });
    const scan = dispatch().enqueueScan(profileId, target.id);
    ctx.services.taskQueue.claim({ workerId: "w", kinds: ["scan"], leaseMs: 60_000 });
    ctx.services.taskQueue.block(scan.task.id, {
      workerId: "w",
      reason: "captcha",
      detail: "reCAPTCHA on the search",
      actor: "worker",
    });
    return { target, scan };
  }

  it("cancels the blocked scan, queues an agent task under the same key, and repoints the scan", () => {
    const { scan } = blockedScan();
    const result = dispatch().handToAgent(scan.task.id, "user");
    expect(ctx.services.taskQueue.getOrThrow(scan.task.id).status).toBe("cancelled");
    expect(result.task).toMatchObject({
      kind: "agent",
      status: "queued",
      dedupeKey: scan.task.dedupeKey,
      payload: {
        purpose: "scan",
        reason: "blocked",
        blockedReason: "captcha",
        previousError: "reCAPTCHA on the search",
      },
    });
    const row = ctx.services.db
      .select()
      .from(scans)
      .where(eq(scans.id, scan.scanId ?? ""))
      .get();
    expect(row?.taskId).toBe(result.task.id);
  });

  it("hands a blocked form removal over with its request and record", () => {
    const target = seedTarget(ctx);
    seedMailbox(ctx, profileId);
    seedRecipe(ctx, target.id, { purpose: "remove" });
    const request = queuedRequest(target.id, { channel: "form", recordUrl: "https://x.test/p/1" });
    const form = dispatch().dispatchRequest(request.id);
    ctx.services.taskQueue.claim({ workerId: "w", kinds: ["form"], leaseMs: 60_000 });
    ctx.services.taskQueue.block(form.task.id, {
      workerId: "w",
      reason: "login_required",
      actor: "worker",
    });
    const { task } = dispatch().handToAgent(form.task.id, "user");
    expect(task).toMatchObject({
      kind: "agent",
      requestId: request.id,
      payload: {
        purpose: "remove",
        requestId: request.id,
        recordUrl: "https://x.test/p/1",
        blockedReason: "login_required",
      },
    });
    expect(
      ctx.services.requests.events(request.id).filter((e) => e.type === "task_cancelled"),
    ).toHaveLength(1);
  });

  it("works for a blocked agent task too", () => {
    const target = seedTarget(ctx);
    const scan = dispatch().enqueueScan(profileId, target.id);
    ctx.services.taskQueue.claim({ workerId: "w", kinds: ["agent"], leaseMs: 60_000 });
    ctx.services.taskQueue.block(scan.task.id, {
      workerId: "w",
      reason: "bot_detection",
      actor: "agent",
    });
    const { task } = dispatch().handToAgent(scan.task.id, "user");
    expect(task.payload).toMatchObject({ reason: "blocked", blockedReason: "bot_detection" });
  });

  it("refuses a task that is not blocked and a kind an agent cannot do", () => {
    const target = seedTarget(ctx);
    const scan = dispatch().enqueueScan(profileId, target.id);
    expect(() => dispatch().handToAgent(scan.task.id, "user")).toThrow(
      expect.objectContaining({ code: "invalid_task_state" }),
    );
    const confirm = seedTask(ctx, {
      kind: "confirm",
      status: "blocked",
      payload: { requestId: "r", url: "https://x.test/c" },
      targetId: target.id,
      profileId,
    });
    expect(() => dispatch().handToAgent(confirm.id, "user")).toThrow(
      expect.objectContaining({ code: "not_handoffable" }),
    );
  });

  it("leaves everything as it was if the agent task cannot be made", () => {
    const { scan } = blockedScan();
    const queue = ctx.services.taskQueue;
    const original = queue.enqueue.bind(queue);
    queue.enqueue = (() => {
      throw new Error("boom");
    }) as never;
    expect(() => dispatch().handToAgent(scan.task.id, "user")).toThrow("boom");
    queue.enqueue = original;
    expect(queue.getOrThrow(scan.task.id).status).toBe("blocked");
  });
});

describe("the other tasks that need one agreed key", () => {
  it("queues a confirmation per request and link, with the target of its request", () => {
    seedMailbox(ctx, profileId);
    const target = seedTarget(ctx);
    const request = queuedRequest(target.id, { channel: "form" });
    const url = "https://broker.test/confirm?t=1";
    const first = dispatch().enqueueConfirm(request.id, url);
    expect(first.created).toBe(true);
    expect(first.task).toMatchObject({
      kind: "confirm",
      targetId: target.id,
      profileId,
      requestId: request.id,
      payload: { requestId: request.id, url },
    });
    expect(first.task.dedupeKey).toMatch(new RegExp(`^confirm:${request.id}:[0-9a-f]{64}$`));
    expect(dispatch().enqueueConfirm(request.id, url).created).toBe(false);
    expect(dispatch().enqueueConfirm(request.id, `${url}&again=1`).created).toBe(true);
    expect(
      ctx.services.requests.events(request.id).filter((e) => e.type === "task_enqueued"),
    ).toHaveLength(2);
  });

  it("queues a canary per recipe, with the recipe's target, so the claim can find it", () => {
    const target = seedTarget(ctx);
    const recipe = seedRecipe(ctx, target.id, { purpose: "scan" });
    const first = dispatch().enqueueCanary(recipe.id);
    expect(first.task).toMatchObject({
      kind: "canary",
      targetId: target.id,
      dedupeKey: `canary:${recipe.id}`,
      payload: { recipeId: recipe.id },
    });
    expect(dispatch().enqueueCanary(recipe.id).created).toBe(false);
    expect(() => dispatch().enqueueCanary("missing")).toThrow(
      expect.objectContaining({ code: "recipe_not_found" }),
    );
  });

  it("queues one inbox poll per mailbox, whoever asks", () => {
    const mailbox = seedMailbox(ctx, profileId);
    const first = dispatch().enqueueInboxPoll(mailbox.id);
    expect(first.task).toMatchObject({
      kind: "inbox_poll",
      profileId,
      dedupeKey: `inbox_poll:${mailbox.id}`,
      payload: { mailboxId: mailbox.id },
    });
    expect(dispatch().enqueueInboxPoll(mailbox.id)).toMatchObject({
      created: false,
      task: { id: first.task.id },
    });
    expect(() => dispatch().enqueueInboxPoll("missing")).toThrow(
      expect.objectContaining({ code: "mailbox_not_found" }),
    );
  });
});

describe("needsRecord", () => {
  it("is the shared rule for people-search and background-check sites", () => {
    const { needsRecord } = dispatch();
    expect(needsRecord({ id: "a", category: "people-search" })).toBe(true);
    expect(needsRecord({ id: "b", category: "background-check" })).toBe(true);
    expect(needsRecord({ id: "c", category: "marketing" })).toBe(false);
  });
});
