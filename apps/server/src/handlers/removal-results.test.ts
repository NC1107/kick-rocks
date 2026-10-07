import { recipes, requests, targets } from "@kickrocks/db";
import type { FormResult } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  DAY,
  seedMailbox,
  seedProfile,
  seedRecipe,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";

let ctx: TestContext;
let profileId: string;
let targetId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  seedMailbox(ctx, profileId);
  targetId = seedTarget(ctx, {
    domain: "records.test",
    category: "people-search",
    contactMethod: "form",
    requirements: ["record_url"],
  }).id;
});

afterEach(async () => {
  await ctx.close();
});

const queue = () => ctx.services.taskQueue;
const RECORD = "https://records.test/p/1";

function openRemoval(recordUrl = RECORD) {
  const { request, dispatch } = ctx.services.requests.open({
    profileId,
    targetId,
    rights: ["opt_out", "delete"],
    channel: "form",
    recordUrl,
    actor: "user",
  });
  return { request, task: dispatch.task };
}

function claim(kind: "form" | "agent") {
  const task = queue().claim({ workerId: "w", kinds: [kind], leaseMs: 60_000 });
  if (!task) throw new Error(`no ${kind} task to claim`);
  return task;
}

function finishForm(result: FormResult) {
  const task = claim("form");
  queue().complete(task.id, { workerId: "w", actor: "worker", result });
  return task;
}

function curateReplyDomains(replyDomains: string[]) {
  const row = ctx.services.targets.getOrThrow(targetId);
  ctx.services.db
    .update(targets)
    .set({ data: { ...row.data, replyDomains } })
    .where(eq(targets.id, targetId))
    .run();
}

function confirmationOf(requestId: string) {
  return eventsOf(requestId).find((event) => event.type === "awaiting_confirmation");
}

const requestOf = (id: string) => ctx.services.requests.getOrThrow(id);
const eventsOf = (id: string) => ctx.services.requests.events(id);
const statuses = (id: string) =>
  eventsOf(id).flatMap((event) => (event.type === "status_changed" ? [event.payload.to] : []));

describe("a form run that finished", () => {
  beforeEach(() => {
    seedRecipe(ctx, targetId, { purpose: "remove" });
  });

  it("moves a submitted request to awaiting_reply and sets its deadlines", () => {
    const { request } = openRemoval();
    finishForm({ outcome: "submitted" });

    expect(requestOf(request.id)).toMatchObject({
      status: "awaiting_reply",
      sentAt: ctx.clock.now().toISOString(),
      dueAt: new Date(ctx.clock.now().getTime() + 45 * DAY).toISOString(),
      followUpAt: new Date(ctx.clock.now().getTime() + 45 * DAY).toISOString(),
      awaitingConfirmationSince: null,
      followUps: 0,
    });
    expect(eventsOf(request.id).find((event) => event.type === "sent")).toMatchObject({
      actor: "worker",
      payload: { channel: "form", kind: "initial", messageId: null },
    });
  });

  it.each(["not_found", "already_removed"] as const)(
    "closes a request as no_record when the outcome is %s, without a send that did not happen",
    (outcome) => {
      const { request } = openRemoval();
      finishForm({ outcome });
      expect(requestOf(request.id)).toMatchObject({ status: "no_record", sentAt: null });
      expect(eventsOf(request.id).some((event) => event.type === "sent")).toBe(false);
      expect(statuses(request.id)).toEqual(["queued", "no_record"]);
    },
  );

  it("waits for the broker's email and remembers who it will come from", () => {
    curateReplyDomains(["sister.test"]);
    ctx.services.db.delete(recipes).run();
    seedRecipe(ctx, targetId, {
      purpose: "remove",
      definition: {
        steps: [
          { kind: "goto", url: "https://records.test/optout" },
          { kind: "email_confirmation", fromDomain: "Sister.test", linkTextPattern: "Confirm" },
          { kind: "expect_text", text: "request received" },
        ],
      },
    });
    const { request } = openRemoval();
    finishForm({ outcome: "awaiting_email_confirmation", confirmationFrom: "mail.records.test" });

    expect(requestOf(request.id)).toMatchObject({
      status: "awaiting_reply",
      awaitingConfirmationSince: ctx.clock.now().toISOString(),
    });
    expect(confirmationOf(request.id)).toMatchObject({
      payload: { fromDomains: ["sister.test", "mail.records.test"], linkTextPattern: "Confirm" },
    });
  });

  it.each(["paypal.com", "linkedin.com", "intuit.com", "stripe.com", "other.test"])(
    "drops %s as a sender the page named, since it is not the target's organization",
    (confirmationFrom) => {
      seedTarget(ctx, { domain: "other.test" });
      for (const domain of ["paypal.com", "linkedin.com", "intuit.com", "stripe.com"]) {
        seedTarget(ctx, { kind: "company", domain });
      }
      const { request } = openRemoval();
      finishForm({ outcome: "awaiting_email_confirmation", confirmationFrom });
      expect(confirmationOf(request.id)).toMatchObject({ payload: { fromDomains: [] } });
    },
  );

  it("drops a shared host even when the target lists it", () => {
    seedTarget(ctx, { domain: "gmail.com" });
    const { request } = openRemoval();
    finishForm({ outcome: "awaiting_email_confirmation", confirmationFrom: "gmail.com" });
    expect(confirmationOf(request.id)).toMatchObject({ payload: { fromDomains: [] } });
  });

  it("keeps a sender on the target's own subdomain", () => {
    const { request } = openRemoval();
    finishForm({ outcome: "awaiting_email_confirmation", confirmationFrom: "Mail.Records.test" });
    expect(confirmationOf(request.id)).toMatchObject({
      payload: { fromDomains: ["mail.records.test"] },
    });
  });

  it("keeps a sister domain that the target's curated reply domains list", () => {
    curateReplyDomains(["sister.test"]);
    const { request } = openRemoval();
    finishForm({ outcome: "awaiting_email_confirmation", confirmationFrom: "sister.test" });
    expect(confirmationOf(request.id)).toMatchObject({ payload: { fromDomains: ["sister.test"] } });
  });

  it("drops a recipe step sender that is neither the target's organization nor curated", () => {
    ctx.services.db.delete(recipes).run();
    seedRecipe(ctx, targetId, {
      purpose: "remove",
      definition: {
        steps: [
          { kind: "goto", url: "https://records.test/optout" },
          { kind: "email_confirmation", fromDomain: "sister.test" },
          { kind: "expect_text", text: "request received" },
        ],
      },
    });
    const { request } = openRemoval();
    finishForm({ outcome: "awaiting_email_confirmation" });
    expect(confirmationOf(request.id)).toMatchObject({ payload: { fromDomains: [] } });
  });

  it.each(["com", "co.uk", "gmail.com"])(
    "ignores a sender of %s that the page named, since it is not a broker",
    (confirmationFrom) => {
      const { request } = openRemoval();
      finishForm({ outcome: "awaiting_email_confirmation", confirmationFrom });
      expect(
        eventsOf(request.id).find((event) => event.type === "awaiting_confirmation"),
      ).toMatchObject({ payload: { fromDomains: [] } });
    },
  );

  it("drops a shared platform that a stored recipe step or the page named as the sender", () => {
    seedTarget(ctx, { domain: "google.com" });
    ctx.services.db.delete(recipes).run();
    const stored = seedRecipe(ctx, targetId, {
      purpose: "remove",
      definition: {
        steps: [
          { kind: "goto", url: "https://records.test/optout" },
          { kind: "email_confirmation", fromDomain: "sister.test" },
          { kind: "expect_text", text: "request received" },
        ],
      },
    });
    ctx.services.db
      .update(recipes)
      .set({
        definition: {
          ...stored.definition,
          steps: stored.definition.steps.map((step) =>
            step.kind === "email_confirmation"
              ? { ...step, fromDomain: "accounts.google.com" }
              : step,
          ),
        },
      })
      .where(eq(recipes.id, stored.id))
      .run();
    const { request } = openRemoval();
    finishForm({ outcome: "awaiting_email_confirmation", confirmationFrom: "google.com" });
    expect(
      eventsOf(request.id).find((event) => event.type === "awaiting_confirmation"),
    ).toMatchObject({ payload: { fromDomains: [] } });
  });

  it("uses what the page said when the recipe names no sender", () => {
    const { request } = openRemoval();
    finishForm({ outcome: "awaiting_email_confirmation", confirmationFrom: "mail.records.test" });
    expect(confirmationOf(request.id)).toMatchObject({
      payload: { fromDomains: ["mail.records.test"], linkTextPattern: null },
    });
  });

  it("is waiting for a confirmation only while the request is awaiting a reply", () => {
    const { request } = openRemoval();
    finishForm({ outcome: "awaiting_email_confirmation" });
    ctx.services.requests.transition(request.id, "confirmed", { actor: "system" });
    expect(requestOf(request.id).awaitingConfirmationSince).toBeNull();
  });

  it("leaves a request alone once it is no longer waiting on the form", () => {
    const { request } = openRemoval();
    const task = claim("form");
    ctx.services.db
      .update(requests)
      .set({ status: "awaiting_reply" })
      .where(eq(requests.id, request.id))
      .run();
    queue().complete(task.id, {
      workerId: "w",
      actor: "worker",
      result: { outcome: "not_found" },
    });
    expect(requestOf(request.id).status).toBe("awaiting_reply");
  });

  it("counts the run for the recipe", () => {
    ctx.services.db.update(recipes).set({ failureCount: 2 }).run();
    openRemoval();
    finishForm({ outcome: "submitted" });
    expect(ctx.services.db.select().from(recipes).get()).toMatchObject({
      failureCount: 0,
      health: "healthy",
    });
  });

  it("clears an earlier error when the request goes out", () => {
    const { request } = openRemoval();
    ctx.services.requests.update(request.id, { lastError: "earlier failure" });
    finishForm({ outcome: "submitted" });
    expect(requestOf(request.id).lastError).toBeNull();
  });
});

describe("a form run that a person finished by hand", () => {
  beforeEach(() => {
    seedRecipe(ctx, targetId, { purpose: "remove" });
  });

  function blocked() {
    const { request, task } = openRemoval();
    claim("form");
    queue().block(task.id, { workerId: "w", reason: "captcha", actor: "worker" });
    return { request, task };
  }

  it("counts a done task with no result as submitted", () => {
    const { request, task } = blocked();
    queue().markDone(task.id, { actor: "user", note: "Did it in my browser" });
    expect(requestOf(request.id).status).toBe("awaiting_reply");
    expect(eventsOf(request.id).find((event) => event.type === "sent")).toMatchObject({
      actor: "user",
    });
  });

  it("applies the outcome the person reports", () => {
    const { request, task } = blocked();
    queue().markDone(task.id, { actor: "user", result: { outcome: "already_removed" } });
    expect(requestOf(request.id).status).toBe("no_record");
  });

  it("does not count a blocked run against the recipe", () => {
    blocked();
    expect(ctx.services.db.select().from(recipes).get()).toMatchObject({ failureCount: 0 });
  });
});

describe("a form run that failed", () => {
  beforeEach(() => {
    seedRecipe(ctx, targetId, { purpose: "remove" });
  });

  function fail(kind: "recipe" | "site", retryable = false) {
    const { request, task } = openRemoval();
    claim("form");
    queue().fail(task.id, {
      workerId: "w",
      error: kind === "recipe" ? "expect_text failed" : "site down",
      retryable,
      kind,
      step: 3,
      actor: "worker",
    });
    return { request, task };
  }

  it("hands a broken recipe's removal to an agent and counts the failure", () => {
    const { request } = fail("recipe");

    const live = queue().list({ requestId: request.id, status: "queued" });
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({
      kind: "agent",
      dedupeKey: `form:${request.id}`,
      payload: {
        purpose: "remove",
        reason: "recipe_failed",
        previousError: "expect_text failed",
        recordUrl: RECORD,
      },
    });
    expect(ctx.services.db.select().from(recipes).get()).toMatchObject({ failureCount: 1 });
    expect(requestOf(request.id)).toMatchObject({ status: "queued", lastError: null });
  });

  it("leaves a site failure with the request for a person to retry", () => {
    const { request } = fail("site");
    expect(requestOf(request.id)).toMatchObject({ status: "queued", lastError: "site down" });
    expect(queue().hasLiveTask(request.id)).toBe(false);
    expect(ctx.services.db.select().from(recipes).get()).toMatchObject({ failureCount: 0 });
  });

  it("does nothing while the task will be retried", () => {
    const { request } = fail("site", true);
    expect(queue().hasLiveTask(request.id)).toBe(true);
    expect(requestOf(request.id).lastError).toBeNull();
  });

  it("does not hand a settled request's work to an agent", () => {
    const { request, task } = openRemoval();
    claim("form");
    ctx.services.db
      .update(requests)
      .set({ status: "awaiting_reply" })
      .where(eq(requests.id, request.id))
      .run();
    queue().fail(task.id, {
      workerId: "w",
      error: "expect_text failed",
      retryable: false,
      kind: "recipe",
      actor: "worker",
    });
    expect(
      queue()
        .list({ requestId: request.id })
        .filter((t) => t.kind === "agent"),
    ).toHaveLength(0);
  });
});

describe("an agent's removal", () => {
  // No recipe is seeded, so the request goes straight to an agent.

  it("applies the agent's outcome like a recipe's", () => {
    const { request } = openRemoval();
    const task = claim("agent");
    queue().complete(task.id, {
      workerId: "w",
      actor: "agent",
      result: { purpose: "remove", form: { outcome: "submitted" } },
    });
    expect(requestOf(request.id)).toMatchObject({ status: "awaiting_reply" });
    expect(eventsOf(request.id).find((event) => event.type === "sent")).toMatchObject({
      actor: "agent",
    });
  });

  it("closes the request when the agent finds nothing to remove", () => {
    const { request } = openRemoval();
    const task = claim("agent");
    queue().complete(task.id, {
      workerId: "w",
      actor: "agent",
      result: { purpose: "remove", form: { outcome: "not_found" } },
    });
    expect(requestOf(request.id).status).toBe("no_record");
  });

  it("does not let a scan result be applied to a removal", () => {
    const { request } = openRemoval();
    const task = claim("agent");
    expect(() =>
      queue().complete(task.id, {
        workerId: "w",
        actor: "agent",
        result: { purpose: "scan", scan: { candidates: [] } },
      }),
    ).toThrow(/does not match/);
    expect(requestOf(request.id).status).toBe("queued");
  });
});

describe("a confirmation a browser opened", () => {
  async function confirming() {
    seedRecipe(ctx, targetId, { purpose: "remove" });
    const { request } = openRemoval();
    finishForm({ outcome: "awaiting_email_confirmation" });
    const { task } = ctx.services.dispatch.enqueueConfirm(
      request.id,
      "https://records.test/confirm?t=1",
    );
    const claimed = queue().claim({ workerId: "w", kinds: ["confirm"], leaseMs: 60_000 });
    return { request, task: claimed ?? task };
  }

  it("is written to the timeline and ends the wait for the email", async () => {
    const { request, task } = await confirming();
    queue().complete(task.id, {
      workerId: "w",
      actor: "worker",
      result: { confirmed: true, finalUrl: "https://records.test/done" },
    });
    expect(eventsOf(request.id).find((event) => event.type === "link_followed")).toMatchObject({
      payload: {
        url: "https://records.test/confirm?t=1",
        finalUrl: "https://records.test/done",
        ok: true,
      },
    });
    expect(requestOf(request.id).awaitingConfirmationSince).toBeNull();
  });

  it("keeps waiting when the page did not confirm", async () => {
    const { request, task } = await confirming();
    queue().complete(task.id, {
      workerId: "w",
      actor: "worker",
      result: { confirmed: false, finalUrl: "javascript:alert(1)" },
    });
    expect(eventsOf(request.id).find((event) => event.type === "link_followed")).toMatchObject({
      payload: { ok: false, finalUrl: null },
    });
    expect(requestOf(request.id).awaitingConfirmationSince).not.toBeNull();
  });
});
