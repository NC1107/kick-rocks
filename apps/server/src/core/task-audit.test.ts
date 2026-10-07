import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MINUTE } from "../test-utils/clock.js";
import {
  createTestContext,
  seedMailbox,
  seedProfile,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { taskOutcome } from "./task-audit.js";

let ctx: TestContext;
let requestId: string;
let profileId: string;
let targetId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  seedMailbox(ctx, profileId);
  targetId = seedTarget(ctx).id;
  requestId = seedRequest(ctx, { profileId, targetId, status: "queued" }).id;
});

afterEach(async () => {
  await ctx.close();
});

const queue = () => ctx.services.taskQueue;
const worker = { workerId: "w1", leaseMs: 5 * MINUTE };

function emailTask(overrides: { requestId?: string | null; maxAttempts?: number } = {}) {
  const id = overrides.requestId === undefined ? requestId : overrides.requestId;
  return queue().enqueue({
    kind: "email_send",
    payload: { requestId: id ?? "none", kind: "initial", fields: [], inReplyTo: null },
    profileId,
    targetId,
    requestId: id,
    ...(overrides.maxAttempts ? { maxAttempts: overrides.maxAttempts } : {}),
  }).task;
}

const claim = () => queue().claim({ ...worker, kinds: ["email_send"] });
const events = (type?: string) =>
  ctx.services.requests.events(requestId).filter((event) => (type ? event.type === type : true));

describe("the timeline of a request follows its tasks", () => {
  it("records a task finishing, with how it ended", () => {
    const task = emailTask();
    claim();
    queue().complete(task.id, { ...worker, result: { sent: true }, actor: "worker" });
    expect(events("task_completed")).toEqual([
      expect.objectContaining({
        payload: { taskId: task.id, kind: "email_send", outcome: null, note: null },
      }),
    ]);
  });

  it("records a block with its reason and detail", () => {
    const task = emailTask();
    claim();
    queue().block(task.id, { ...worker, reason: "captcha", detail: "reCAPTCHA", actor: "worker" });
    expect(events("task_blocked")[0]?.payload).toEqual({
      taskId: task.id,
      kind: "email_send",
      reason: "captcha",
      detail: "reCAPTCHA",
    });
  });

  it("records a terminal failure and sets the request's last error, so a request with no live task says it needs a person", () => {
    const task = emailTask({ maxAttempts: 1 });
    claim();
    queue().fail(task.id, {
      ...worker,
      error: "535 bad credentials",
      retryable: true,
      kind: "site",
      actor: "worker",
    });
    expect(events("task_failed")[0]?.payload).toEqual({
      taskId: task.id,
      kind: "email_send",
      error: "535 bad credentials",
      failureKind: "site",
    });
    expect(ctx.services.requests.getOrThrow(requestId).lastError).toBe("535 bad credentials");
  });

  it("records a retry, not a failure, when the task will be tried again", () => {
    const task = emailTask();
    claim();
    queue().fail(task.id, { ...worker, error: "timeout", retryable: true, actor: "worker" });
    expect(events("task_failed")).toEqual([]);
    expect(events("task_retrying")[0]?.payload).toEqual({
      taskId: task.id,
      kind: "email_send",
      error: "timeout",
      attempt: 1,
    });
    expect(ctx.services.requests.getOrThrow(requestId).lastError).toBeNull();
  });

  it("records a cancel and a resume", () => {
    const first = emailTask();
    queue().cancel(first.id, "user");
    const second = emailTask();
    claim();
    queue().block(second.id, { ...worker, reason: "unknown", actor: "worker" });
    queue().resume(second.id);
    expect(events("task_cancelled")).toHaveLength(1);
    expect(events("task_resumed")).toHaveLength(1);
  });

  it("notes what a person wrote when they finished a blocked task by hand", () => {
    const task = emailTask();
    claim();
    queue().block(task.id, { ...worker, reason: "captcha", actor: "worker" });
    queue().markDone(task.id, { actor: "user", note: "Submitted it myself" });
    expect(events("task_completed")[0]?.payload).toMatchObject({ note: "Submitted it myself" });
  });

  it("writes nothing for a task that belongs to no request", () => {
    const task = emailTask({ requestId: null });
    claim();
    queue().complete(task.id, { ...worker, result: {}, actor: "worker" });
    expect(events().map((e) => e.type)).toEqual(["created"]);
  });

  it("writes in the transaction of the change, so the timeline and the queue never disagree", () => {
    const task = emailTask();
    claim();
    ctx.services.taskHandlers.on("email_send", "completed", () => {
      throw new Error("a later handler broke");
    });
    expect(() => queue().complete(task.id, { ...worker, result: {}, actor: "worker" })).toThrow(
      "a later handler broke",
    );
    expect(queue().getOrThrow(task.id).status).toBe("leased");
    expect(events("task_completed")).toEqual([]);
  });

  it("puts the task event before whatever a module handler writes for the same change", () => {
    const task = emailTask();
    claim();
    ctx.services.taskHandlers.on("email_send", "completed", () => {
      ctx.services.requests.addEvent(requestId, {
        type: "note",
        actor: "system",
        payload: { text: "handled" },
      });
    });
    queue().complete(task.id, { ...worker, result: {}, actor: "worker" });
    expect(events().map((e) => e.type)).toEqual(["created", "task_completed", "note"]);
  });
});

describe("taskOutcome", () => {
  const task = (kind: string, result: unknown) => ({ kind, result }) as never;

  it("names how each kind of task ended", () => {
    expect(taskOutcome(task("form", { outcome: "not_found" }))).toBe("not_found");
    expect(taskOutcome(task("agent", { purpose: "remove", form: { outcome: "submitted" } }))).toBe(
      "submitted",
    );
    expect(taskOutcome(task("agent", { purpose: "scan", scan: { candidates: [] } }))).toBe(
      "scanned",
    );
    expect(taskOutcome(task("scan", { candidates: [{}, {}] }))).toBe("2 candidates");
    expect(taskOutcome(task("confirm", { confirmed: false, finalUrl: "x" }))).toBe("not_confirmed");
    expect(taskOutcome(task("canary", { healthy: true, missingSelectors: [] }))).toBe("healthy");
    expect(taskOutcome(task("email_send", { ok: true }))).toBeNull();
    expect(taskOutcome(task("form", null))).toBeNull();
  });
});
