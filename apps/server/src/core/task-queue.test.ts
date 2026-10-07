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
import {
  DEFAULT_LAPSED_HOLDER_GRACE_MS,
  DEFAULT_MAX_ATTEMPTS,
  retryDelayMs, TASK_PRIORITY, type TaskQueue } from "./task-queue.js";
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

const emailPayload = (requestId = "r1") => ({
  requestId,
  kind: "initial" as const,
  fields: [],
  inReplyTo: null,
});
const pollPayload = (mailboxId = "m1") => ({ mailboxId });
const worker = { workerId: "worker-1", leaseMs: 5 * MINUTE };

function claimOne(
  kinds: Parameters<TaskQueue["claim"]>[0]["kinds"] = ["email_send", "inbox_poll"],
) {
  const task = queue.claim({ ...worker, kinds });
  if (!task) throw new Error("expected a task to claim");
  return task;
}

function errorOf(call: () => unknown): AppError | undefined {
  try {
    call();
  } catch (error) {
    return error as AppError;
  }
  return undefined;
}

const codeOf = (call: () => unknown) => errorOf(call)?.code;

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
      payload: { requestId: "r1", kind: "initial", fields: [], inReplyTo: null },
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
        queue.block(leased.id, { ...worker, reason: "captcha", actor: "worker" });
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
    else queue.complete(claimOne().id, { ...worker, result: {}, actor: "worker" });
    const again = queue.enqueue({ kind: "email_send", payload: emailPayload(), dedupeKey: "k" });
    expect(again.created).toBe(true);
    expect(again.task.id).not.toBe(first.task.id);
  });

  it("refuses to share a key between kinds", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload(), dedupeKey: "k" });
    expect(
      codeOf(() => queue.enqueue({ kind: "inbox_poll", payload: pollPayload(), dedupeKey: "k" })),
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
    queue.block(claimOne().id, { ...worker, reason: "captcha", actor: "worker" });
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
    expect(codeOf(() => queue.heartbeat(task.id, { workerId: "intruder", leaseMs: MINUTE }))).toBe(
      "lease_not_held",
    );
    expect(
      codeOf(() => queue.heartbeat("missing", { workerId: "worker-1", leaseMs: MINUTE })),
    ).toBe("task_not_found");
  });

  it("rejects a task that is not leased", async () => {
    const { task } = queue.enqueue({ kind: "email_send", payload: emailPayload() });
    expect(codeOf(() => queue.heartbeat(task.id, { workerId: "worker-1", leaseMs: MINUTE }))).toBe(
      "lease_not_held",
    );
  });
});

describe("complete", () => {
  it("stores the validated result and frees the lease", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    const done = queue.complete(task.id, {
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
    const error = errorOf(() =>
      queue.complete(task.id, { ...worker, result: { confirmed: "yes" }, actor: "worker" }),
    );
    expect(error).toMatchObject({ status: 400, code: "invalid_result" });
    expect(error?.issues?.length).toBeGreaterThan(0);
    expect(queue.getOrThrow(task.id).status).toBe("leased");
  });

  it("rejects a caller that does not hold the lease", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    expect(
      codeOf(() => queue.complete(task.id, { workerId: "intruder", result: {}, actor: "worker" })),
    ).toBe("lease_not_held");
    expect(queue.getOrThrow(task.id).status).toBe("leased");
  });

  it("rejects a second completion", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    queue.complete(task.id, { ...worker, result: {}, actor: "worker" });
    expect(codeOf(() => queue.complete(task.id, { ...worker, result: {}, actor: "worker" }))).toBe(
      "lease_not_held",
    );
  });

  it("tells handlers while the change is being made, and they see it", async () => {
    const seen: Array<{ event: TaskEvent; stored: string | undefined }> = [];
    ctx.services.taskHandlers.on("email_send", "completed", (event) => {
      seen.push({ event, stored: queue.get(event.task.id)?.status });
    });
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    queue.complete(task.id, { ...worker, result: { ok: true }, actor: "agent" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.stored).toBe("done");
    expect(seen[0]?.event).toMatchObject({
      name: "completed",
      actor: "agent",
      task: { id: task.id, result: { ok: true } },
    });
  });

  it("rolls the whole change back when a handler throws, so the worker can report again", async () => {
    let broken = true;
    ctx.services.taskHandlers.on("email_send", "completed", () => {
      if (broken) throw new Error("handler broke");
    });
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    expect(() => queue.complete(task.id, { ...worker, result: {}, actor: "worker" })).toThrow(
      "handler broke",
    );
    expect(queue.getOrThrow(task.id)).toMatchObject({
      status: "leased",
      leaseOwner: "worker-1",
      result: null,
    });
    broken = false;
    expect(queue.complete(task.id, { ...worker, result: {}, actor: "worker" }).status).toBe("done");
  });
});

describe("block", () => {
  it("parks the task with a reason and a screenshot", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const blocked = queue.block(task.id, {
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
    const blocked = queue.block(claimOne().id, {
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
      codeOf(() =>
        queue.block(task.id, {
          ...worker,
          reason: "captcha",
          screenshot: { mime: "image/png", data: tooBig },
          actor: "worker",
        }),
      ),
    ).toBe("screenshot_too_large");
    expect(
      codeOf(() =>
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
      codeOf(() =>
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
    queue.block(claimOne().id, { ...worker, reason: "bot_detection", actor: "worker" });
    expect(reasons).toEqual(["bot_detection"]);
  });

  it("returns the newest screenshot when a task blocks twice", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const first = claimOne();
    queue.block(first.id, {
      ...worker,
      reason: "captcha",
      screenshot: { mime: "image/png", data: Buffer.from([1]) },
      actor: "worker",
    });
    queue.resume(first.id);
    claimOne();
    ctx.clock.advance(SECOND);
    queue.block(first.id, {
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
    const failed = queue.fail(task.id, {
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
    const failed = queue.fail(claimOne().id, {
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
    const failed = queue.fail(claimOne().id, {
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
    const first = queue.fail(claimOne().id, {
      ...worker,
      error: "e1",
      retryable: true,
      actor: "worker",
    });
    expect(first.status).toBe("queued");
    expect(failures).toEqual([]);
    ctx.clock.advance(DAY);
    const second = queue.fail(claimOne().id, {
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
      codeOf(() =>
        queue.fail(task.id, { workerId: "intruder", error: "x", retryable: true, actor: "worker" }),
      ),
    ).toBe("lease_not_held");
  });
});

describe("resume, markDone, and cancel", () => {
  function blockedTask() {
    queue.enqueue({ kind: "email_send", payload: emailPayload(), dedupeKey: "k" });
    return queue.block(claimOne().id, {
      ...worker,
      reason: "captcha",
      detail: "x",
      actor: "worker",
    });
  }

  it("resume re-queues with a fresh attempt budget and clears the block", async () => {
    const blocked = blockedTask();
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
    expect(codeOf(() => queue.resume(task.id))).toBe("invalid_task_state");
    expect(codeOf(() => queue.resume("missing"))).toBe("task_not_found");
  });

  it("markDone closes a blocked task with no result and tells handlers", async () => {
    const seen: Array<[string, unknown]> = [];
    ctx.services.taskHandlers.on(
      "email_send",
      "completed",
      ({ actor, task }) => void seen.push([actor, task.result]),
    );
    const blocked = blockedTask();
    const done = queue.markDone(blocked.id, { actor: "user" });
    expect(done).toMatchObject({ status: "done", result: null });
    expect(seen).toEqual([["user", null]]);
  });

  it("markDone refuses a task that is not blocked", async () => {
    const { task } = queue.enqueue({ kind: "email_send", payload: emailPayload() });
    expect(codeOf(() => queue.markDone(task.id, { actor: "user" }))).toBe("invalid_task_state");
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
        queue.block(task.id, { ...worker, reason: "captcha", actor: "worker" });
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
    expect(codeOf(() => queue.complete(task.id, { ...worker, result: {}, actor: "worker" }))).toBe(
      "lease_not_held",
    );
  });

  it("cancel refuses a finished task", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    queue.complete(task.id, { ...worker, result: {}, actor: "worker" });
    expect(codeOf(() => queue.cancel(task.id))).toBe("invalid_task_state");
  });
});

describe("reapExpiredLeases", () => {
  it("returns an expired lease to the queue after a backoff", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    ctx.clock.advance(5 * MINUTE - 1);
    expect(queue.reapExpiredLeases()).toEqual([]);
    ctx.clock.advance(1);
    const [reaped] = queue.reapExpiredLeases();
    expect(reaped).toMatchObject({
      id: task.id,
      status: "queued",
      leaseOwner: "worker-1",
      lastError: "The lease expired",
      runAfter: new Date(
        ctx.clock.now().getTime() + DEFAULT_LAPSED_HOLDER_GRACE_MS,
      ).toISOString(),
    });
  });

  it("lets a late worker be rejected once someone else took over", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    ctx.clock.advance(DAY);
    queue.reapExpiredLeases();
    ctx.clock.advance(DEFAULT_LAPSED_HOLDER_GRACE_MS);
    const second = queue.claim({ workerId: "worker-2", kinds: ["email_send"], leaseMs: MINUTE });
    expect(second?.id).toBe(task.id);
    expect(codeOf(() => queue.complete(task.id, { ...worker, result: {}, actor: "worker" }))).toBe(
      "lease_not_held",
    );
    expect(
      queue.complete(task.id, { workerId: "worker-2", result: {}, actor: "worker" }),
    ).toMatchObject({ status: "done" });
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
    const [reaped] = queue.reapExpiredLeases();
    expect(reaped?.status).toBe("failed");
    expect(seen).toEqual(["system:The lease expired"]);
  });

  it("leaves live leases and other states alone", async () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload("a") });
    queue.enqueue({ kind: "email_send", payload: emailPayload("b") });
    claimOne();
    ctx.clock.advance(MINUTE);
    expect(queue.reapExpiredLeases()).toEqual([]);
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
    queue.block(withShot.id, {
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
    queue.block(old.id, {
      ...worker,
      reason: "captcha",
      screenshot: { mime: "image/png", data: Buffer.from([1]) },
      actor: "worker",
    });
    queue.markDone(old.id, { actor: "user" });
    ctx.clock.advance(31 * DAY);

    queue.enqueue({ kind: "email_send", payload: emailPayload("blocked") });
    const stillBlocked = claimOne();
    queue.block(stillBlocked.id, {
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

const agentScanPayload = (profileId = "p1", targetId = "t1") => ({
  purpose: "scan" as const,
  profileId,
  targetId,
  requestId: null,
  recordUrl: null,
  variant: null,
  reason: "no_recipe" as const,
  previousError: null,
  blockedReason: null,
});

describe("what the queue records about who did the work", () => {
  it("stamps who claimed it, from the route that claimed it", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    expect(claimOne().claimerKind).toBeNull();
    queue.enqueue({ kind: "email_send", payload: emailPayload("b") });
    const claimed = queue.claim({ ...worker, kinds: ["email_send"], claimerKind: "mcp" });
    expect(claimed?.claimerKind).toBe("mcp");
  });

  it("records who finished it and sums what each attempt cost", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const first = claimOne();
    queue.fail(first.id, {
      ...worker,
      error: "timeout",
      retryable: true,
      retryAfterMs: 0,
      kind: "network",
      usage: { inputTokens: 100, costUsd: 0.01 },
      actor: "worker",
    });
    queue.claim({ ...worker, workerId: "worker-2", kinds: ["email_send"], claimerKind: "model" });
    const done = queue.complete(first.id, {
      workerId: "worker-2",
      result: {},
      usage: { inputTokens: 50, outputTokens: 20, durationMs: 900 },
      actor: "worker",
    });
    expect(done).toMatchObject({
      finishedBy: "worker-2",
      claimerKind: "model",
      usage: { inputTokens: 150, outputTokens: 20, costUsd: 0.01, durationMs: 900 },
    });
  });

  it("shows the same facts in a task summary", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    queue.complete(task.id, { ...worker, result: {}, usage: { durationMs: 5 }, actor: "worker" });
    expect(queue.summarize([queue.getOrThrow(task.id)])[0]).toMatchObject({
      finishedBy: "worker-1",
      usage: { durationMs: 5 },
      failureKind: null,
    });
  });
});

describe("what a failure says about itself", () => {
  it("never retries a recipe failure, whatever the worker asks for", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const failed = queue.fail(claimOne().id, {
      ...worker,
      error: "selector gone",
      retryable: true,
      kind: "recipe",
      step: 3,
      actor: "worker",
    });
    expect(failed).toMatchObject({
      status: "failed",
      failureKind: "recipe",
      failureStep: 3,
      lastError: "selector gone",
    });
  });

  it("retries a site or network failure and keeps what broke", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const retried = queue.fail(claimOne().id, {
      ...worker,
      error: "502",
      retryable: true,
      kind: "site",
      actor: "worker",
    });
    expect(retried).toMatchObject({ status: "queued", failureKind: "site", failureStep: null });
  });

  it("calls a failure internal unless it is told otherwise", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const failed = queue.fail(claimOne().id, {
      ...worker,
      error: "x",
      retryable: false,
      actor: "worker",
    });
    expect(failed.failureKind).toBe("internal");
  });

  it("tells handlers whether a failure is final or will be retried", () => {
    const seen: string[] = [];
    ctx.services.taskHandlers.on(
      "email_send",
      ["failed", "retrying"],
      ({ name, task }) => void seen.push(`${name}:${task.attempts}`),
    );
    queue.enqueue({ kind: "email_send", payload: emailPayload(), maxAttempts: 2 });
    queue.fail(claimOne().id, {
      ...worker,
      error: "a",
      retryable: true,
      retryAfterMs: 0,
      actor: "worker",
    });
    queue.fail(claimOne().id, { ...worker, error: "b", retryable: true, actor: "worker" });
    expect(seen).toEqual(["retrying:1", "failed:2"]);
  });

  it("keeps the page where a worker got stuck", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const blocked = queue.block(claimOne().id, {
      ...worker,
      reason: "captcha",
      url: "https://broker.test/optout?step=2",
      actor: "worker",
    });
    expect(blocked.blockedUrl).toBe("https://broker.test/optout?step=2");
    expect(queue.resume(blocked.id).blockedUrl).toBeNull();
  });
});

describe("release", () => {
  it("hands a task back unstarted: queued, no lease, and the attempt is not counted", () => {
    const events: string[] = [];
    ctx.services.taskHandlers.on(
      "email_send",
      ["failed", "retrying", "cancelled", "blocked", "completed", "resumed"],
      ({ name }) => void events.push(name),
    );
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    const released = queue.release(task.id, worker);
    expect(released).toMatchObject({
      status: "queued",
      leaseOwner: null,
      attempts: 0,
      runAfter: null,
    });
    expect(events).toEqual([]);
    expect(claimOne().attempts).toBe(1);
  });

  it("can hold the task back until a time", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    const until = new Date(ctx.clock.now().getTime() + 10 * MINUTE);
    queue.release(task.id, { ...worker, runAfter: until });
    expect(queue.claim({ ...worker, kinds: ["email_send"] })).toBeNull();
    ctx.clock.advance(10 * MINUTE);
    expect(queue.claim({ ...worker, kinds: ["email_send"] })?.id).toBe(task.id);
  });

  it("is refused to a caller that does not hold the lease", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    expect(codeOf(() => queue.release(task.id, { workerId: "intruder" }))).toBe("lease_not_held");
    expect(queue.getOrThrow(task.id).status).toBe("leased");
  });

  it("never takes the attempt count below zero", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    queue.release(task.id, worker);
    queue.claim({ ...worker, kinds: ["email_send"] });
    queue.release(task.id, worker);
    expect(queue.getOrThrow(task.id).attempts).toBe(0);
  });
});

describe("claim filters", () => {
  let capped: string;
  let roomy: string;
  const forProfile = (profileId: string) =>
    queue.enqueue({ kind: "email_send", payload: emailPayload(profileId), profileId }).task;

  beforeEach(() => {
    capped = seedProfile(ctx).id;
    roomy = seedProfile(ctx).id;
  });

  it("claims only a task of the profile asked for", () => {
    forProfile(capped);
    const wanted = forProfile(roomy);
    expect(queue.claim({ ...worker, kinds: ["email_send"], profileId: roomy })?.id).toBe(wanted.id);
    expect(queue.claim({ ...worker, kinds: ["email_send"], profileId: roomy })).toBeNull();
  });

  it("skips the profiles it is told to, so a capped mailbox does not hold up one that has room", () => {
    forProfile(capped);
    const wanted = forProfile(roomy);
    expect(queue.claim({ ...worker, kinds: ["email_send"], excludeProfileIds: [capped] })?.id).toBe(
      wanted.id,
    );
    expect(
      queue.claim({ ...worker, kinds: ["email_send"], excludeProfileIds: [capped] }),
    ).toBeNull();
  });

  it("still claims a task that belongs to no profile when profiles are excluded", () => {
    const loose = queue.enqueue({ kind: "email_send", payload: emailPayload() }).task;
    expect(queue.claim({ ...worker, kinds: ["email_send"], excludeProfileIds: [capped] })?.id).toBe(
      loose.id,
    );
  });
});

describe("expired leases", () => {
  it("are recovered by the next claim, even with the scheduler off", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const stuck = claimOne();
    ctx.clock.advance(5 * MINUTE);
    // The claim recovers the task, but it waits out the grace for its holder before it is handed out again.
    expect(
      queue.claim({ workerId: "worker-2", kinds: ["email_send"], leaseMs: MINUTE }),
    ).toBeNull();
    expect(queue.getOrThrow(stuck.id)).toMatchObject({
      status: "queued",
      lastError: "The lease expired",
    });
    ctx.clock.advance(DEFAULT_LAPSED_HOLDER_GRACE_MS);
    const next = queue.claim({ workerId: "worker-2", kinds: ["email_send"], leaseMs: MINUTE });
    expect(next).toMatchObject({ id: stuck.id, leaseOwner: "worker-2", attempts: 2 });
  });

  it("fail for good in a claim when no attempts are left, and tell handlers", () => {
    const seen: string[] = [];
    ctx.services.taskHandlers.on("email_send", "failed", ({ task }) => void seen.push(task.id));
    queue.enqueue({ kind: "email_send", payload: emailPayload(), maxAttempts: 1 });
    const stuck = claimOne();
    ctx.clock.advance(5 * MINUTE);
    expect(
      queue.claim({ workerId: "worker-2", kinds: ["email_send"], leaseMs: MINUTE }),
    ).toBeNull();
    expect(queue.getOrThrow(stuck.id)).toMatchObject({ status: "failed", failureKind: "internal" });
    expect(seen).toEqual([stuck.id]);
  });

  it("tell a worker it is late when it heartbeats, instead of reviving the lease", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    ctx.clock.advance(5 * MINUTE);
    expect(codeOf(() => queue.heartbeat(task.id, { workerId: "worker-1", leaseMs: MINUTE }))).toBe(
      "lease_expired",
    );
    expect(queue.getOrThrow(task.id).leaseExpiresAt).toBe(task.leaseExpiresAt);
  });

  it("still let the worker that holds one report finished work until someone takes over", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    ctx.clock.advance(2 * 60 * MINUTE);
    queue.reapExpiredLeases();
    expect(queue.getOrThrow(task.id).status).toBe("queued");
    expect(
      queue.complete(task.id, { ...worker, result: { late: true }, actor: "worker" }).status,
    ).toBe("done");
  });
});

describe("a report after the lease was reaped", () => {
  it("keeps a late failure and a late block from the last holder too", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload("a") });
    queue.enqueue({ kind: "email_send", payload: emailPayload("b") });
    const first = claimOne();
    const second = claimOne();
    ctx.clock.advance(DAY);
    queue.reapExpiredLeases();

    expect(
      queue.fail(first.id, {
        ...worker,
        error: "late",
        retryable: false,
        kind: "site",
        actor: "worker",
      }).status,
    ).toBe("failed");
    expect(queue.getOrThrow(second.id).status).toBe("queued");
  });

  it("refuses a report from a worker that never held the task", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    ctx.clock.advance(DAY);
    queue.reapExpiredLeases();
    expect(
      codeOf(() => queue.complete(task.id, { workerId: "other", result: {}, actor: "worker" })),
    ).toBe("lease_not_held");
  });

  it("does not let the last holder revive the lease with a heartbeat", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    ctx.clock.advance(DAY);
    queue.reapExpiredLeases();
    expect(codeOf(() => queue.heartbeat(task.id, { ...worker }))).toBe("lease_expired");
  });

  it("tells a worker that another worker now holds the task that the lease is not held", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    ctx.clock.advance(DAY);
    queue.reapExpiredLeases();
    ctx.clock.advance(DEFAULT_LAPSED_HOLDER_GRACE_MS);
    const taken = queue.claim({ workerId: "worker-2", kinds: ["email_send"], leaseMs: MINUTE });
    expect(taken?.id).toBe(task.id);
    expect(codeOf(() => queue.heartbeat(task.id, { ...worker }))).toBe("lease_not_held");
  });

  it("submits once when the reaper recovers the lease before the holder's heartbeat", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    const submissions = ["worker-1"];
    ctx.clock.advance(5 * MINUTE + 5 * SECOND);
    queue.reapExpiredLeases();

    expect(codeOf(() => queue.heartbeat(task.id, { ...worker }))).toBe("lease_expired");

    const other = queue.claim({ workerId: "worker-2", kinds: ["email_send"], leaseMs: MINUTE });
    if (other) submissions.push("worker-2");
    ctx.clock.advance(2 * MINUTE);
    const stillOther = queue.claim({ workerId: "worker-2", kinds: ["email_send"], leaseMs: MINUTE });
    if (stillOther) submissions.push("worker-2");

    expect(queue.complete(task.id, { ...worker, result: {}, actor: "worker" }).status).toBe("done");
    expect(submissions).toEqual(["worker-1"]);
  });

  it("lets another worker take a recovered task once the holder has been silent past the grace", () => {
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const task = claimOne();
    ctx.clock.advance(5 * MINUTE + 5 * SECOND);
    queue.reapExpiredLeases();
    ctx.clock.advance(6 * MINUTE);
    const other = queue.claim({ workerId: "worker-2", kinds: ["email_send"], leaseMs: MINUTE });
    expect(other?.id).toBe(task.id);
  });
});

describe("dedupe across kinds that are the same work", () => {
  it("returns the live task of another kind that the caller names as the same work", () => {
    const agent = queue.enqueue({
      kind: "agent",
      payload: agentScanPayload(),
      dedupeKey: "scan:p1:t1",
    }).task;
    const again = queue.enqueue({
      kind: "scan",
      payload: { profileId: "p1", targetId: "t1", recipeId: "t1.scan.v1", variant: null },
      dedupeKey: "scan:p1:t1",
      sameWork: ["agent"],
    });
    expect(again.created).toBe(false);
    expect(again.task.id).toBe(agent.id);
  });

  it("still refuses a kind that is not named, since that is a bug", () => {
    queue.enqueue({ kind: "agent", payload: agentScanPayload(), dedupeKey: "scan:p1:t1" });
    expect(
      codeOf(() =>
        queue.enqueue({
          kind: "scan",
          payload: { profileId: "p1", targetId: "t1", recipeId: null, variant: null },
          dedupeKey: "scan:p1:t1",
          sameWork: ["form"],
        }),
      ),
    ).toBe("dedupe_key_conflict");
  });

  it("takes the key again once the other task is no longer live", () => {
    const agent = queue.enqueue({
      kind: "agent",
      payload: agentScanPayload(),
      dedupeKey: "scan:p1:t1",
    }).task;
    queue.cancel(agent.id);
    const created = queue.enqueue({
      kind: "scan",
      payload: { profileId: "p1", targetId: "t1", recipeId: null, variant: null },
      dedupeKey: "scan:p1:t1",
      sameWork: ["agent"],
    });
    expect(created.created).toBe(true);
  });
});

describe("results are checked against the task, not the caller's claim", () => {
  const scanResult = { purpose: "scan", scan: { candidates: [] } };
  const removeResult = { purpose: "remove", form: { outcome: "submitted" } };

  it("refuses a removal result for a scan agent task", () => {
    const task = queue.enqueue({ kind: "agent", payload: agentScanPayload() }).task;
    queue.claim({ ...worker, kinds: ["agent"] });
    expect(
      errorOf(() => queue.complete(task.id, { ...worker, result: removeResult, actor: "agent" })),
    ).toMatchObject({ status: 400, code: "invalid_result" });
    expect(queue.getOrThrow(task.id).status).toBe("leased");
    expect(queue.complete(task.id, { ...worker, result: scanResult, actor: "agent" }).status).toBe(
      "done",
    );
  });

  it("refuses a scan result for a removal agent task", () => {
    const task = queue.enqueue({
      kind: "agent",
      payload: { ...agentScanPayload(), purpose: "remove", requestId: "r1" },
    }).task;
    queue.claim({ ...worker, kinds: ["agent"] });
    expect(
      codeOf(() => queue.complete(task.id, { ...worker, result: scanResult, actor: "agent" })),
    ).toBe("invalid_result");
    expect(
      queue.complete(task.id, { ...worker, result: removeResult, actor: "agent" }).status,
    ).toBe("done");
  });
});

describe("finishing a blocked task by hand", () => {
  const blockedAgent = (purpose: "scan" | "remove") => {
    const { task } = queue.enqueue({
      kind: "agent",
      payload: { ...agentScanPayload(), purpose, requestId: purpose === "remove" ? "r1" : null },
    });
    queue.claim({ ...worker, kinds: ["agent"] });
    return queue.block(task.id, { ...worker, reason: "captcha", actor: "agent" });
  };

  it("stores a validated result, wrapped the way an agent would have reported it", () => {
    const blocked = blockedAgent("remove");
    const done = queue.markDone(blocked.id, {
      actor: "user",
      result: { outcome: "already_removed" },
      note: "Removed by hand",
    });
    expect(done.result).toEqual({ purpose: "remove", form: { outcome: "already_removed" } });
  });

  it("passes the result and the note to handlers", () => {
    const seen: unknown[] = [];
    ctx.services.taskHandlers.on("agent", "completed", ({ task, note, actor }) => {
      seen.push([actor, note, task.result]);
    });
    const blocked = blockedAgent("scan");
    queue.markDone(blocked.id, {
      actor: "user",
      result: { candidates: [] },
      note: "Nothing there",
    });
    expect(seen).toEqual([
      ["user", "Nothing there", { purpose: "scan", scan: { candidates: [] } }],
    ]);
  });

  it("refuses a result that is not what the task would report, and leaves it blocked", () => {
    const blocked = blockedAgent("remove");
    expect(
      errorOf(() => queue.markDone(blocked.id, { actor: "user", result: { outcome: "done" } })),
    ).toMatchObject({ code: "invalid_result" });
    expect(queue.getOrThrow(blocked.id).status).toBe("blocked");
    expect(
      codeOf(() => queue.markDone(blocked.id, { actor: "user", result: { candidates: [] } })),
    ).toBe("invalid_result");
  });
});

describe("events for cancelling and resuming", () => {
  it("tells handlers when a task is cancelled, once, with who did it", () => {
    const seen: string[] = [];
    ctx.services.taskHandlers.on(
      "email_send",
      "cancelled",
      ({ actor, task }) => void seen.push(`${actor}:${task.status}`),
    );
    const { task } = queue.enqueue({ kind: "email_send", payload: emailPayload() });
    queue.cancel(task.id, "user");
    queue.cancel(task.id, "user");
    expect(seen).toEqual(["user:cancelled"]);
  });

  it("tells handlers when a blocked task is resumed", () => {
    const seen: string[] = [];
    ctx.services.taskHandlers.on(
      "email_send",
      "resumed",
      ({ actor, task }) => void seen.push(`${actor}:${task.status}`),
    );
    queue.enqueue({ kind: "email_send", payload: emailPayload() });
    const blocked = queue.block(claimOne().id, { ...worker, reason: "unknown", actor: "worker" });
    queue.resume(blocked.id);
    expect(seen).toEqual(["user:queued"]);
  });
});

describe("cancelForRequest", () => {
  it("cancels every live task of the request and leaves the rest", () => {
    const profile = seedProfile(ctx);
    const target = seedTarget(ctx);
    const r1 = seedRequest(ctx, { profileId: profile.id, targetId: target.id }).id;
    const r2 = seedRequest(ctx, { profileId: profile.id, targetId: target.id }).id;
    const seed = (requestId: string) =>
      queue.enqueue({ kind: "email_send", payload: emailPayload(requestId), requestId }).task;
    const mine = seed(r1);
    const other = seed(r2);
    const done = seed(r1);
    queue.claim({ ...worker, kinds: ["email_send"], taskId: done.id });
    queue.complete(done.id, { ...worker, result: {}, actor: "worker" });
    const cancelled = queue.cancelForRequest(r1, "user");
    expect(cancelled.map((t) => t.id)).toEqual([mine.id]);
    expect(queue.getOrThrow(other.id).status).toBe("queued");
    expect(queue.getOrThrow(done.id).status).toBe("done");
    expect(queue.hasLiveTask(r1)).toBe(false);
    expect(queue.hasLiveTask(r2)).toBe(true);
  });
});
