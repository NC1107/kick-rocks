import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAY, MINUTE, SECOND } from "../test-utils/clock.js";
import {
  createTestContext,
  seedProfile,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import type { AppError } from "./errors.js";
import { DEFAULT_MAX_ATTEMPTS, retryDelayMs, TASK_PRIORITY, type TaskQueue } from "./task-queue.js";
import type { TaskEvent } from "./task-types.js";

let ctx: TestContext;
let queue: TaskQueue;

beforeEach(async () => {
  ctx = await createTestContext();
  queue = ctx.services.taskQueue;
});

afterEach(async () => {
  await ctx.close();
});

const emailPayload = (requestId = "r1") => ({ requestId, followUp: false });
const pollPayload = (mailboxId = "m1") => ({ mailboxId });
const worker = { workerId: "worker-1", leaseMs: 5 * MINUTE };

function claimOne(
  kinds: Parameters<TaskQueue["claim"]>[0]["kinds"] = ["email_send", "inbox_poll"],
) {
  const task = queue.claim({ ...worker, kinds });
  if (!task) throw new Error("expected a task to claim");
  return task;
}

async function codeOf(promise: Promise<unknown> | (() => unknown)): Promise<string | undefined> {
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (error) {
    return (error as AppError).code;
  }
  return undefined;
}

describe("enqueue", () => {
  it("creates a queued task with defaults for its kind", () => {
    const { task, created } = queue.enqueue({ kind: "email_send", payload: emailPayload() });
    expect(created).toBe(true);
    expect(task).toMatchObject({
      kind: "email_send",
      status: "queued",
      priority: TASK_PRIORITY.email_send,
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      payload: { requestId: "r1", followUp: false },
      result: null,
      leaseOwner: null,
      runAfter: null,
      createdAt: ctx.clock.now().toISOString(),
    });
  });

  it("validates the payload for the kind", () => {
    expect(() =>
      queue.enqueue({ kind: "email_send", payload: { requestId: "r1" } as never }),
    ).toThrow();
    expect(() =>
      queue.enqueue({ kind: "confirm", payload: { requestId: "r", url: "javascript:x" } }),
    ).toThrow();
  });

  it("honors explicit priority, attempts, and run time", () => {
    const runAfter = new Date(ctx.clock.now().getTime() + DAY);
    const { task } = queue.enqueue({
      kind: "inbox_poll",
      payload: pollPayload(),
      priority: 99,
      maxAttempts: 7,
      runAfter,
    });
    expect(task).toMatchObject({ priority: 99, maxAttempts: 7, runAfter: runAfter.toISOString() });
  });

  it("returns the live task for a repeated dedupe key", () => {
    const first = queue.enqueue({ kind: "email_send", payload: emailPayload(), dedupeKey: "k" });
    const second = queue.enqueue({
      kind: "email_send",
      payload: emailPayload("other"),
      dedupeKey: "k",
    });
    expect(second.created).toBe(false);
    expect(second.task.id).toBe(first.task.id);
    expect(queue.list()).toHaveLength(1);
  });

  it.each(["leased", "blocked"] as const)(
    "keeps the key taken while a task is %s",
    async (state) => {
      const first = queue.enqueue({ kind: "email_send", payload: emailPayload(), dedupeKey: "k" });
      const leased = claimOne();
      if (state === "blocked")
        await queue.block(leased.id, { ...worker, reason: "captcha", actor: "worker" });
      expect(
        queue.enqueue({ kind: "email_send", payload: emailPayload(), dedupeKey: "k" }),
      ).toMatchObject({
        created: false,
        task: { id: first.task.id },
      });
    },
  );

  it.each(["complete", "cancel"] as const)("frees the key once a task is %s", async (how) => {
    const first = queue.enqueue({ kind: "email_send", payload: emailPayload(), dedupeKey: "k" });
    if (how === "cancel") queue.cancel(first.task.id);
    else await queue.complete(claimOne().id, { ...worker, result: {}, actor: "worker" });
    const again = queue.enqueue({ kind: "email_send", payload: emailPayload(), dedupeKey: "k" });
    expect(again.created).toBe(true);
    expect(again.task.id).not.toBe(first.task.id);
  });

  it("refuses to share a key between kinds", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload(), dedupeKey: "k" });
    expect(
      await codeOf(() =>
        queue.enqueue({ kind: "inbox_poll", payload: pollPayload(), dedupeKey: "k" }),
      ),
    ).toBe("dedupe_key_conflict");
  });

  it("lets tasks without a key coexist", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    expect(queue.enqueue({ kind: "email_send", payload: emailPayload() }).created).toBe(true);
  });
});

describe("claim", () => {
  it("takes the highest priority first, then the oldest", () => {
    const low = queue.enqueue({
      kind: "email_send",
      payload: emailPayload("low"),
      priority: 1,
    }).task;
    const oldNormal = queue.enqueue({
      kind: "email_send",
      payload: emailPayload("old"),
      priority: 5,
    }).task;
    ctx.clock.advance(SECOND);
    const newNormal = queue.enqueue({
      kind: "email_send",
      payload: emailPayload("new"),
      priority: 5,
    }).task;
    const high = queue.enqueue({
      kind: "email_send",
      payload: emailPayload("high"),
      priority: 9,
    }).task;
    expect([claimOne().id, claimOne().id, claimOne().id, claimOne().id]).toEqual([
      high.id,
      oldNormal.id,
      newNormal.id,
      low.id,
    ]);
  });

  it("keeps insertion order among tasks created in the same instant", () => {
    const ids = [1, 2, 3, 4, 5].map(
      (n) => queue.enqueue({ kind: "email_send", payload: emailPayload(`r${n}`) }).task.id,
    );
    expect(ids.map(() => claimOne().id)).toEqual(ids);
  });

  it("leases the task and counts the attempt", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    expect(task).toMatchObject({
      status: "leased",
      leaseOwner: "worker-1",
      attempts: 1,
      leaseExpiresAt: new Date(ctx.clock.now().getTime() + 5 * MINUTE).toISOString(),
    });
  });

  it("never hands one task to two callers", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    expect(claimOne().leaseOwner).toBe("worker-1");
    expect(
      queue.claim({ workerId: "worker-2", kinds: ["email_send"], leaseMs: MINUTE }),
    ).toBeNull();
  });

  it("only claims the kinds asked for", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    expect(queue.claim({ ...worker, kinds: ["inbox_poll"] })).toBeNull();
    expect(queue.claim({ ...worker, kinds: [] })).toBeNull();
    expect(queue.claim({ ...worker, kinds: ["inbox_poll", "email_send"] })).not.toBeNull();
  });

  it("skips a task until its run time", () => {
    queue.enqueue({
      kind: "email_send",
      payload: emailPayload(),
      runAfter: new Date(ctx.clock.now().getTime() + MINUTE),
    });
    expect(queue.claim({ ...worker, kinds: ["email_send"] })).toBeNull();
    ctx.clock.advance(MINUTE - 1);
    expect(queue.claim({ ...worker, kinds: ["email_send"] })).toBeNull();
    ctx.clock.advance(1);
    expect(queue.claim({ ...worker, kinds: ["email_send"] })).not.toBeNull();
  });

  it("can claim one specific queued task", () => {
    const first = queue.enqueue({ kind: "email_send", payload: emailPayload("a") }).task;
    const second = queue.enqueue({ kind: "email_send", payload: emailPayload("b") }).task;
    expect(queue.claim({ ...worker, kinds: ["email_send"], taskId: second.id })?.id).toBe(
      second.id,
    );
    expect(queue.claim({ ...worker, kinds: ["email_send"], taskId: second.id })).toBeNull();
    expect(queue.claim({ ...worker, kinds: ["email_send"] })?.id).toBe(first.id);
  });

  it("ignores blocked, done, and cancelled tasks", async () => {
    const a = queue.enqueue({ kind: "email_send", payload: emailPayload("a") }).task;
    const b = queue.enqueue({ kind: "email_send", payload: emailPayload("b") }).task;
    queue.cancel(a.id);
    await queue.block(claimOne().id, { ...worker, reason: "captcha", actor: "worker" });
    expect(b.id).toBeTruthy();
    expect(queue.claim({ ...worker, kinds: ["email_send"] })).toBeNull();
  });
});

describe("heartbeat", () => {
  it("extends the lease from now", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    ctx.clock.advance(2 * MINUTE);
    const beat = queue.heartbeat(task.id, { workerId: "worker-1", leaseMs: 10 * MINUTE });
    expect(beat.leaseExpiresAt).toBe(
      new Date(ctx.clock.now().getTime() + 10 * MINUTE).toISOString(),
    );
  });

  it("rejects a caller that does not hold the lease", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    expect(
      await codeOf(() => queue.heartbeat(task.id, { workerId: "intruder", leaseMs: MINUTE })),
    ).toBe("lease_not_held");
    expect(
      await codeOf(() => queue.heartbeat("missing", { workerId: "worker-1", leaseMs: MINUTE })),
    ).toBe("task_not_found");
  });

  it("rejects a task that is not leased", async () => {
    const { task } = queue.enqueue({ kind: "email_send", payload: emailPayload() });
    expect(
      await codeOf(() => queue.heartbeat(task.id, { workerId: "worker-1", leaseMs: MINUTE })),
    ).toBe("lease_not_held");
  });
});

describe("complete", () => {
  it("stores the validated result and frees the lease", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    const done = await queue.complete(task.id, {
      ...worker,
      result: { messageId: "<x@example.com>" },
      actor: "worker",
    });
    expect(done).toMatchObject({
      status: "done",
      result: { messageId: "<x@example.com>" },
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  });

  it("rejects a result that does not match the kind and leaves the lease alone", async () => {
    const { task } = queue.enqueue({
      kind: "confirm",
      payload: { requestId: "r", url: "https://x.test/c" },
    });
    queue.claim({ ...worker, kinds: ["confirm"] });
    const error = await queue
      .complete(task.id, { ...worker, result: { confirmed: "yes" }, actor: "worker" })
      .catch((e: AppError) => e);
    expect(error).toMatchObject({ status: 400, code: "invalid_result" });
    expect((error as AppError).issues?.length).toBeGreaterThan(0);
    expect(queue.getOrThrow(task.id).status).toBe("leased");
  });

  it("rejects a caller that does not hold the lease", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    expect(
      await codeOf(queue.complete(task.id, { workerId: "intruder", result: {}, actor: "worker" })),
    ).toBe("lease_not_held");
    expect(queue.getOrThrow(task.id).status).toBe("leased");
  });

  it("rejects a second completion", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    await queue.complete(task.id, { ...worker, result: {}, actor: "worker" });
    expect(await codeOf(queue.complete(task.id, { ...worker, result: {}, actor: "worker" }))).toBe(
      "lease_not_held",
    );
  });

  it("tells handlers after the change has committed", async () => {
    const seen: Array<{ event: TaskEvent; stored: string | undefined }> = [];
    ctx.services.taskHandlers.on("email_send", "completed", (event) => {
      seen.push({ event, stored: queue.get(event.task.id)?.status });
    });
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    await queue.complete(task.id, { ...worker, result: { ok: true }, actor: "agent" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.stored).toBe("done");
    expect(seen[0]?.event).toMatchObject({
      name: "completed",
      actor: "agent",
      task: { id: task.id, result: { ok: true } },
    });
  });

  it("keeps the task done when a handler throws", async () => {
    ctx.services.taskHandlers.on("email_send", "completed", () => {
      throw new Error("handler broke");
    });
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    await expect(
      queue.complete(task.id, { ...worker, result: {}, actor: "worker" }),
    ).resolves.toMatchObject({ status: "done" });
  });
});

describe("block", () => {
  it("parks the task with a reason and a screenshot", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const blocked = await queue.block(task.id, {
      ...worker,
      reason: "captcha",
      detail: "reCAPTCHA on submit",
      screenshot: { mime: "image/png", data: png },
      actor: "worker",
    });
    expect(blocked).toMatchObject({
      status: "blocked",
      blockedReason: "captcha",
      blockedDetail: "reCAPTCHA on submit",
      leaseOwner: null,
      attempts: 1,
    });
    expect(queue.screenshot(task.id)).toEqual({ mime: "image/png", data: png });
  });

  it("works without a screenshot", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const blocked = await queue.block(claimOne().id, {
      ...worker,
      reason: "unknown",
      actor: "agent",
    });
    expect(blocked.blockedDetail).toBeNull();
    expect(queue.screenshot(blocked.id)).toBeNull();
  });

  it("rejects an oversized or non-image screenshot without changing the task", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    const tooBig = Buffer.alloc(8 * 1024 * 1024 + 1);
    expect(
      await codeOf(
        queue.block(task.id, {
          ...worker,
          reason: "captcha",
          screenshot: { mime: "image/png", data: tooBig },
          actor: "worker",
        }),
      ),
    ).toBe("screenshot_too_large");
    expect(
      await codeOf(
        queue.block(task.id, {
          ...worker,
          reason: "captcha",
          screenshot: { mime: "text/html" as never, data: Buffer.from("x") },
          actor: "worker",
        }),
      ),
    ).toBe("invalid_screenshot");
    expect(queue.getOrThrow(task.id).status).toBe("leased");
  });

  it("rejects a caller that does not hold the lease and stores nothing", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    const png = Buffer.from([1]);
    expect(
      await codeOf(
        queue.block(task.id, {
          workerId: "intruder",
          reason: "captcha",
          screenshot: { mime: "image/png", data: png },
          actor: "worker",
        }),
      ),
    ).toBe("lease_not_held");
    expect(queue.screenshot(task.id)).toBeNull();
  });

  it("notifies blocked handlers with the reason", async () => {
    const reasons: Array<string | null> = [];
    ctx.services.taskHandlers.on(
      "email_send",
      "blocked",
      ({ task }) => void reasons.push(task.blockedReason),
    );
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    await queue.block(claimOne().id, { ...worker, reason: "bot_detection", actor: "worker" });
    expect(reasons).toEqual(["bot_detection"]);
  });

  it("returns the newest screenshot when a task blocks twice", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const first = claimOne();
    await queue.block(first.id, {
      ...worker,
      reason: "captcha",
      screenshot: { mime: "image/png", data: Buffer.from([1]) },
      actor: "worker",
    });
    queue.resume(first.id);
    claimOne();
    ctx.clock.advance(SECOND);
    await queue.block(first.id, {
      ...worker,
      reason: "captcha",
      screenshot: { mime: "image/jpeg", data: Buffer.from([2]) },
      actor: "worker",
    });
    expect(queue.screenshot(first.id)).toEqual({ mime: "image/jpeg", data: Buffer.from([2]) });
  });
});

describe("fail", () => {
  it("re-queues a retryable failure after a backoff", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    const failed = await queue.fail(task.id, {
      ...worker,
      error: "smtp timeout",
      retryable: true,
      actor: "worker",
    });
    expect(failed).toMatchObject({
      status: "queued",
      lastError: "smtp timeout",
      leaseOwner: null,
      runAfter: new Date(ctx.clock.now().getTime() + retryDelayMs(1)).toISOString(),
    });
    expect(queue.claim({ ...worker, kinds: ["email_send"] })).toBeNull();
    ctx.clock.advance(retryDelayMs(1));
    expect(queue.claim({ ...worker, kinds: ["email_send"] })?.attempts).toBe(2);
  });

  it("backs off exponentially up to an hour", () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(retryDelayMs(30)).toBe(60 * MINUTE);
    expect(retryDelayMs(0)).toBe(30_000);
  });

  it("uses the delay the caller asks for", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const failed = await queue.fail(claimOne().id, {
      ...worker,
      error: "slow down",
      retryable: true,
      retryAfterMs: 5 * MINUTE,
      actor: "worker",
    });
    expect(failed.runAfter).toBe(new Date(ctx.clock.now().getTime() + 5 * MINUTE).toISOString());
  });

  it("fails for good when the failure is not retryable", async () => {
    const events: string[] = [];
    ctx.services.taskHandlers.on(
      "email_send",
      "failed",
      ({ task, actor }) => void events.push(`${task.status}:${actor}`),
    );
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const failed = await queue.fail(claimOne().id, {
      ...worker,
      error: "bad recipe",
      retryable: false,
      actor: "worker",
    });
    expect(failed).toMatchObject({ status: "failed", lastError: "bad recipe" });
    expect(events).toEqual(["failed:worker"]);
  });

  it("fails for good once attempts run out, and only then tells handlers", async () => {
    const failures: number[] = [];
    ctx.services.taskHandlers.on(
      "email_send",
      "failed",
      ({ task }) => void failures.push(task.attempts),
    );
    queue.enqueue({ kind: "email_send", payload: emailPayload(), maxAttempts: 2 });
    const first = await queue.fail(claimOne().id, {
      ...worker,
      error: "e1",
      retryable: true,
      actor: "worker",
    });
    expect(first.status).toBe("queued");
    expect(failures).toEqual([]);
    ctx.clock.advance(DAY);
    const second = await queue.fail(claimOne().id, {
      ...worker,
      error: "e2",
      retryable: true,
      actor: "worker",
    });
    expect(second).toMatchObject({ status: "failed", lastError: "e2", attempts: 2 });
    expect(failures).toEqual([2]);
  });

  it("rejects a caller that does not hold the lease", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    expect(
      await codeOf(
        queue.fail(task.id, { workerId: "intruder", error: "x", retryable: true, actor: "worker" }),
      ),
    ).toBe("lease_not_held");
  });
});

describe("resume, markDone, and cancel", () => {
  async function blockedTask() {
    queue.enqueue({ kind: "email_send", payload: emailPayload(), dedupeKey: "k" });
    return queue.block(claimOne().id, {
      ...worker,
      reason: "captcha",
      detail: "x",
      actor: "worker",
    });
  }

  it("resume re-queues with a fresh attempt budget and clears the block", async () => {
    const blocked = await blockedTask();
    const resumed = queue.resume(blocked.id);
    expect(resumed).toMatchObject({
      status: "queued",
      blockedReason: null,
      blockedDetail: null,
      attempts: 0,
      runAfter: null,
    });
    expect(queue.claim({ ...worker, kinds: ["email_send"] })?.attempts).toBe(1);
  });

  it("resume only works on a blocked task", async () => {
    const { task } = queue.enqueue({ kind: "email_send", payload: emailPayload() });
    expect(await codeOf(() => queue.resume(task.id))).toBe("invalid_task_state");
    expect(await codeOf(() => queue.resume("missing"))).toBe("task_not_found");
  });

  it("markDone closes a blocked task with no result and tells handlers", async () => {
    const seen: Array<[string, unknown]> = [];
    ctx.services.taskHandlers.on(
      "email_send",
      "completed",
      ({ actor, task }) => void seen.push([actor, task.result]),
    );
    const blocked = await blockedTask();
    const done = await queue.markDone(blocked.id, "user");
    expect(done).toMatchObject({ status: "done", result: null });
    expect(seen).toEqual([["user", null]]);
  });

  it("markDone refuses a task that is not blocked", async () => {
    const { task } = queue.enqueue({ kind: "email_send", payload: emailPayload() });
    expect(await codeOf(queue.markDone(task.id, "user"))).toBe("invalid_task_state");
  });

  it.each(["queued", "leased", "blocked"] as const)(
    "cancels a %s task and frees its key",
    async (state) => {
      const { task } = queue.enqueue({
        kind: "email_send",
        payload: emailPayload(),
        dedupeKey: "k",
      });
      if (state !== "queued") claimOne();
      if (state === "blocked")
        await queue.block(task.id, { ...worker, reason: "captcha", actor: "worker" });
      expect(queue.cancel(task.id)).toMatchObject({ status: "cancelled", leaseOwner: null });
      expect(
        queue.enqueue({ kind: "email_send", payload: emailPayload(), dedupeKey: "k" }).created,
      ).toBe(true);
    },
  );

  it("cancel is idempotent and a cancelled leased task cannot be completed", async () => {
    const { task } = queue.enqueue({ kind: "email_send", payload: emailPayload() });
    claimOne();
    queue.cancel(task.id);
    expect(queue.cancel(task.id).status).toBe("cancelled");
    expect(await codeOf(queue.complete(task.id, { ...worker, result: {}, actor: "worker" }))).toBe(
      "lease_not_held",
    );
  });

  it("cancel refuses a finished task", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    await queue.complete(task.id, { ...worker, result: {}, actor: "worker" });
    expect(await codeOf(() => queue.cancel(task.id))).toBe("invalid_task_state");
  });
});

describe("reapExpiredLeases", () => {
  it("returns an expired lease to the queue after a backoff", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    ctx.clock.advance(5 * MINUTE - 1);
    expect(await queue.reapExpiredLeases()).toEqual([]);
    ctx.clock.advance(1);
    const [reaped] = await queue.reapExpiredLeases();
    expect(reaped).toMatchObject({
      id: task.id,
      status: "queued",
      leaseOwner: null,
      lastError: "The lease expired",
      runAfter: new Date(ctx.clock.now().getTime() + retryDelayMs(1)).toISOString(),
    });
  });

  it("lets a late worker be rejected once someone else took over", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    ctx.clock.advance(DAY);
    await queue.reapExpiredLeases();
    ctx.clock.advance(retryDelayMs(1));
    const second = queue.claim({ workerId: "worker-2", kinds: ["email_send"], leaseMs: MINUTE });
    expect(second?.id).toBe(task.id);
    expect(await codeOf(queue.complete(task.id, { ...worker, result: {}, actor: "worker" }))).toBe(
      "lease_not_held",
    );
    await expect(
      queue.complete(task.id, { workerId: "worker-2", result: {}, actor: "worker" }),
    ).resolves.toMatchObject({ status: "done" });
  });

  it("fails a task with no attempts left and tells handlers it was the system", async () => {
    const seen: string[] = [];
    ctx.services.taskHandlers.on(
      "email_send",
      "failed",
      ({ actor, task }) => void seen.push(`${actor}:${task.lastError}`),
    );
    queue.enqueue({ kind: "email_send", payload: emailPayload(), maxAttempts: 1 });
    claimOne();
    ctx.clock.advance(DAY);
    const [reaped] = await queue.reapExpiredLeases();
    expect(reaped?.status).toBe("failed");
    expect(seen).toEqual(["system:The lease expired"]);
  });

  it("leaves live leases and other states alone", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload("a") });
    queue.enqueue({ kind: "email_send", payload: emailPayload("b") });
    claimOne();
    ctx.clock.advance(MINUTE);
    expect(await queue.reapExpiredLeases()).toEqual([]);
    expect(queue.list({ status: "queued" })).toHaveLength(1);
  });
});

describe("get and list", () => {
  it("returns null for a missing task and throws a 404 from getOrThrow", () => {
    expect(queue.get("missing")).toBeNull();
    expect(() => queue.getOrThrow("missing")).toThrow(/not found/);
  });

  it("lists newest first and filters", () => {
    const profile = seedProfile(ctx);
    const target = seedTarget(ctx);
    const request = seedRequest(ctx, { profileId: profile.id, targetId: target.id });
    const a = queue.enqueue({ kind: "email_send", payload: emailPayload("a") }).task;
    ctx.clock.advance(SECOND);
    const b = queue.enqueue({
      kind: "inbox_poll",
      payload: pollPayload(),
      profileId: profile.id,
    }).task;
    ctx.clock.advance(SECOND);
    const c = queue.enqueue({
      kind: "email_send",
      payload: emailPayload("c"),
      requestId: request.id,
      targetId: target.id,
    }).task;
    claimOne(["inbox_poll"]);

    expect(queue.list().map((t) => t.id)).toEqual([c.id, b.id, a.id]);
    expect(queue.list({ status: "queued" }).map((t) => t.id)).toEqual([c.id, a.id]);
    expect(queue.list({ status: ["leased", "done"] }).map((t) => t.id)).toEqual([b.id]);
    expect(queue.list({ kinds: ["inbox_poll"] }).map((t) => t.id)).toEqual([b.id]);
    expect(queue.list({ profileId: profile.id }).map((t) => t.id)).toEqual([b.id]);
    expect(queue.list({ requestId: request.id }).map((t) => t.id)).toEqual([c.id]);
    expect(queue.list({ targetId: target.id }).map((t) => t.id)).toEqual([c.id]);
    expect(queue.list({ limit: 1, offset: 1 }).map((t) => t.id)).toEqual([b.id]);
  });
});

describe("summarize", () => {
  it("adds the target name and whether a screenshot exists, and carries no payload", async () => {
    const target = seedTarget(ctx, { name: "Example Broker" });
    queue.enqueue({ kind: "email_send", payload: emailPayload("b"), targetId: target.id });
    const plain = queue.enqueue({ kind: "email_send", payload: emailPayload("a") }).task;
    const withShot = claimOne();
    await queue.block(withShot.id, {
      ...worker,
      reason: "captcha",
      detail: "d",
      screenshot: { mime: "image/png", data: Buffer.from([1]) },
      actor: "worker",
    });
    const summaries = queue.summarize(queue.list());
    const blocked = summaries.find((s) => s.id === withShot.id);
    expect(blocked).toMatchObject({
      targetName: "Example Broker",
      hasScreenshot: true,
      blockedReason: "captcha",
      blockedDetail: "d",
    });
    expect(summaries.find((s) => s.id === plain.id)).toMatchObject({
      targetName: null,
      hasScreenshot: false,
    });
    expect(JSON.stringify(summaries)).not.toContain("payload");
    expect(queue.summarize([])).toEqual([]);
  });
});

describe("purgeArtifacts", () => {
  it("deletes screenshots of old finished tasks only", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload("old") });
    const old = claimOne();
    await queue.block(old.id, {
      ...worker,
      reason: "captcha",
      screenshot: { mime: "image/png", data: Buffer.from([1]) },
      actor: "worker",
    });
    await queue.markDone(old.id, "user");
    ctx.clock.advance(31 * DAY);

    queue.enqueue({ kind: "email_send", payload: emailPayload("blocked") });
    const stillBlocked = claimOne();
    await queue.block(stillBlocked.id, {
      ...worker,
      reason: "captcha",
      screenshot: { mime: "image/png", data: Buffer.from([2]) },
      actor: "worker",
    });

    const removed = queue.purgeArtifacts(new Date(ctx.clock.now().getTime() - 30 * DAY));
    expect(removed).toBe(1);
    expect(queue.screenshot(old.id)).toBeNull();
    expect(queue.screenshot(stillBlocked.id)).not.toBeNull();
  });
});
