import { matches, scans } from "@kickrocks/db";
import {
  API_ROUTES,
  type ClaimedTask,
  SCREENSHOT_BODY_LIMIT_BYTES,
  WORKER_DEFAULT_KINDS,
} from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  seedMailbox,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedTarget,
  seedTask,
  type TestContext,
} from "../../test-utils/index.js";
import { decodeScreenshot } from "./screenshot.js";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("not really an image"),
]);

let ctx: TestContext;
let profileId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
});

afterEach(async () => {
  await ctx.close();
});

/** A people-search target with a scan recipe and a scan task waiting for the built-in worker. */
function queueScan() {
  const target = seedTarget(ctx, { category: "people-search" });
  seedRecipe(ctx, target.id, { purpose: "scan" });
  ctx.services.dispatch.enqueueScan(profileId, target.id);
  return target;
}

async function claim(body: Record<string, unknown> = {}) {
  const result = await ctx.call(API_ROUTES.workerClaim, {
    body: { workerId: "worker-1", ...body },
  });
  if (!result.ok) throw new Error(`claim answered ${result.status}`);
  return result.body.task;
}

describe("authentication", () => {
  it("turns away a call without the token or with the wrong one, and a session is no substitute", async () => {
    queueScan();
    const none = await ctx.app.inject({
      method: "POST",
      url: "/api/worker/claim",
      payload: { workerId: "w" },
    });
    expect(none.statusCode).toBe(401);
    const wrong = await ctx.app.inject({
      method: "POST",
      url: "/api/worker/claim",
      headers: { authorization: "Bearer not-the-token" },
      payload: { workerId: "w" },
    });
    expect(wrong.statusCode).toBe(401);
    const session = await ctx.inject({
      method: "POST",
      url: "/api/worker/claim",
      payload: { workerId: "w" },
    });
    expect(session.statusCode).toBe(401);
  });

  it("is off when no worker token is configured", async () => {
    const off = await createTestContext({ env: { KICKROCKS_WORKER_TOKEN: "" } });
    try {
      const response = await off.app.inject({
        method: "POST",
        url: "/api/worker/claim",
        headers: { authorization: `Bearer ${ctx.workerToken}` },
        payload: { workerId: "w" },
      });
      expect(response.statusCode).toBe(503);
    } finally {
      await off.close();
    }
  });
});

describe("heartbeat", () => {
  it("records what the worker says about itself for the settings page", async () => {
    const result = await ctx.call(API_ROUTES.workerHeartbeat, {
      body: { workerId: "worker-1", version: "0.3.0", busy: true, currentTaskId: "t1" },
    });
    expect(result.ok && result.body).toEqual({
      ok: true,
      serverTime: ctx.clock.now().toISOString(),
    });
    expect(ctx.services.settings.get("worker.status")).toEqual({
      workerId: "worker-1",
      version: "0.3.0",
      lastSeenAt: ctx.clock.now().toISOString(),
      busy: true,
      currentTaskId: "t1",
    });
  });

  it("keeps the latest heartbeat and fills in what the worker left out", async () => {
    await ctx.call(API_ROUTES.workerHeartbeat, { body: { workerId: "a", busy: true } });
    ctx.clock.advance(30_000);
    await ctx.call(API_ROUTES.workerHeartbeat, { body: { workerId: "b", busy: false } });
    expect(ctx.services.settings.get("worker.status")).toMatchObject({
      workerId: "b",
      version: null,
      busy: false,
      currentTaskId: null,
      lastSeenAt: ctx.clock.now().toISOString(),
    });
  });

  it("validates the body", async () => {
    const result = await ctx.call(API_ROUTES.workerHeartbeat, {
      body: { workerId: "", busy: "yes" } as never,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });
});

describe("claim", () => {
  it("leases the next browser task with its recipe, fields, and target", async () => {
    const target = queueScan();
    const task = (await claim()) as ClaimedTask;
    expect(task).toMatchObject({
      kind: "scan",
      attempt: 1,
      target: { id: target.id },
      recipe: { purpose: "scan" },
      fields: { first_name: "Jordan", last_name: "Example" },
    });
    expect(ctx.services.taskQueue.getOrThrow(task.id)).toMatchObject({
      status: "leased",
      leaseOwner: "worker-1",
      claimerKind: "builtin",
    });
  });

  it("answers null when nothing is waiting", async () => {
    expect(await claim()).toBeNull();
  });

  it("takes only the kinds a recipe can run unless told otherwise", async () => {
    const target = seedTarget(ctx, { category: "people-search" });
    ctx.services.dispatch.enqueueScan(profileId, target.id);
    expect(WORKER_DEFAULT_KINDS).not.toContain("agent");
    expect(await claim()).toBeNull();
    expect((await claim({ kinds: ["agent"] }))?.kind).toBe("agent");
  });

  it("records a model-backed worker as such", async () => {
    queueScan();
    const task = await claim({ claimer: "model" });
    expect(ctx.services.taskQueue.getOrThrow(task?.id as string).claimerKind).toBe("model");
  });

  it("does not hand one task to two workers", async () => {
    queueScan();
    expect(await claim({ workerId: "a" })).not.toBeNull();
    expect(await claim({ workerId: "b" })).toBeNull();
  });

  it("validates the kinds and the lease", async () => {
    for (const body of [
      { workerId: "w", kinds: ["email_send"] },
      { workerId: "w", kinds: [] },
      { workerId: "w", leaseMs: 5 },
      { workerId: "w", claimer: "mcp" },
    ]) {
      const result = await ctx.call(API_ROUTES.workerClaim, { body: body as never });
      expect(result.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("fails a task that cannot be prepared and moves on to the one behind it", async () => {
    const target = seedTarget(ctx, { category: "marketing" });
    const request = seedRequest(ctx, {
      profileId,
      targetId: target.id,
      channel: "form",
      status: "awaiting_reply",
    });
    const unsafe = seedTask(ctx, {
      kind: "confirm",
      profileId,
      targetId: target.id,
      requestId: request.id,
      payload: { requestId: request.id, url: "https://collector.example.org/confirm" },
    });
    const good = queueScan();
    const task = await claim({ kinds: ["confirm", "scan"] });
    expect(task?.target.id).toBe(good.id);
    expect(ctx.services.taskQueue.getOrThrow(unsafe.id)).toMatchObject({
      status: "failed",
      failureKind: "internal",
    });
  });
});

describe("working a task", () => {
  it("extends the lease", async () => {
    queueScan();
    const task = (await claim()) as ClaimedTask;
    ctx.clock.advance(120_000);
    const result = await ctx.call(API_ROUTES.workerTaskHeartbeat, {
      params: { id: task.id },
      body: { workerId: "worker-1", leaseMs: 600_000 },
    });
    expect(result.ok && result.body.leaseExpiresAt).toBe(
      new Date(ctx.clock.now().getTime() + 600_000).toISOString(),
    );
  });

  it("tells a worker that is too late", async () => {
    queueScan();
    const task = (await claim()) as ClaimedTask;
    ctx.clock.advance(60 * 60 * 1000);
    const result = await ctx.call(API_ROUTES.workerTaskHeartbeat, {
      params: { id: task.id },
      body: { workerId: "worker-1" },
    });
    expect(result.ok).toBe(false);
    expect(result.ok || result.body.error).toBe("lease_expired");
  });

  it("completes a task, checks the result against its kind, and records the usage", async () => {
    queueScan();
    const task = (await claim()) as ClaimedTask;
    const bad = await ctx.call(API_ROUTES.workerTaskComplete, {
      params: { id: task.id },
      body: { workerId: "worker-1", result: { outcome: "submitted" } },
    });
    expect(bad.ok || bad.body.error).toBe("invalid_result");
    expect(bad.ok || bad.body.issues?.length).toBeGreaterThan(0);

    const good = await ctx.call(API_ROUTES.workerTaskComplete, {
      params: { id: task.id },
      body: {
        workerId: "worker-1",
        result: { candidates: [] },
        usage: { durationMs: 4200 },
      },
    });
    expect(good.ok && good.body.task).toMatchObject({
      status: "done",
      finishedBy: "worker-1",
      claimerKind: "builtin",
      usage: { durationMs: 4200 },
    });
  });

  it("refuses a worker that does not hold the lease", async () => {
    queueScan();
    const task = (await claim()) as ClaimedTask;
    const result = await ctx.call(API_ROUTES.workerTaskComplete, {
      params: { id: task.id },
      body: { workerId: "intruder", result: { candidates: [] } },
    });
    expect(result.ok || result.body.error).toBe("lease_not_held");
  });

  it("answers 404 for a task that does not exist", async () => {
    const result = await ctx.call(API_ROUTES.workerTaskComplete, {
      params: { id: "nope" },
      body: { workerId: "w", result: {} },
    });
    expect(result.status).toBe(404);
  });

  it("parks a task for a human with a screenshot", async () => {
    queueScan();
    const task = (await claim()) as ClaimedTask;
    const result = await ctx.call(API_ROUTES.workerTaskBlock, {
      params: { id: task.id },
      body: {
        workerId: "worker-1",
        reason: "captcha",
        detail: "reCAPTCHA on the search form",
        url: "https://example.test/search",
        screenshot: { mime: "image/png", dataBase64: PNG.toString("base64") },
        usage: { durationMs: 900 },
      },
    });
    expect(result.ok && result.body.task).toMatchObject({
      status: "blocked",
      blockedReason: "captcha",
      blockedUrl: "https://example.test/search",
      hasScreenshot: true,
    });
    expect(ctx.services.taskQueue.screenshot(task.id)?.data.equals(PNG)).toBe(true);
  });

  it("takes a screenshot of the size the contract allows, which is more than a default body", async () => {
    queueScan();
    const task = (await claim()) as ClaimedTask;
    const image = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(7 * 1024 * 1024)]);
    const result = await ctx.call(API_ROUTES.workerTaskBlock, {
      params: { id: task.id },
      body: {
        workerId: "worker-1",
        reason: "captcha",
        screenshot: { mime: "image/png", dataBase64: image.toString("base64") },
      },
    });
    expect(result.ok).toBe(true);
    expect(Math.ceil((image.byteLength * 4) / 3)).toBeLessThan(SCREENSHOT_BODY_LIMIT_BYTES);
  });

  it("refuses a body past the screenshot limit, and applies that limit to that route alone", async () => {
    queueScan();
    const task = (await claim()) as ClaimedTask;
    const huge = JSON.stringify({
      workerId: "w",
      reason: "captcha",
      pad: "x".repeat(SCREENSHOT_BODY_LIMIT_BYTES),
    });
    const block = await ctx.injectWorker({
      method: "POST",
      url: `/api/worker/tasks/${task.id}/block`,
      payload: huge,
      headers: { "content-type": "application/json" },
    });
    expect(block.statusCode).toBe(413);
    const fail = await ctx.injectWorker({
      method: "POST",
      url: `/api/worker/tasks/${task.id}/fail`,
      payload: JSON.stringify({
        error: "x".repeat(2 * 1024 * 1024),
        retryable: false,
        workerId: "w",
      }),
      headers: { "content-type": "application/json" },
    });
    expect(fail.statusCode).toBe(413);
  });

  it("rejects a screenshot that is not an image of the declared type", async () => {
    queueScan();
    const task = (await claim()) as ClaimedTask;
    for (const dataBase64 of ["###", Buffer.from("<script>").toString("base64")]) {
      const result = await ctx.call(API_ROUTES.workerTaskBlock, {
        params: { id: task.id },
        body: {
          workerId: "worker-1",
          reason: "captcha",
          screenshot: { mime: "image/png", dataBase64 },
        },
      });
      expect(result.ok || result.body.error).toBe("invalid_screenshot");
    }
    expect(ctx.services.taskQueue.getOrThrow(task.id).status).toBe("leased");
  });

  it("reports a failure with its kind and step, retrying when it may be retried", async () => {
    queueScan();
    const task = (await claim()) as ClaimedTask;
    const result = await ctx.call(API_ROUTES.workerTaskFail, {
      params: { id: task.id },
      body: { workerId: "worker-1", error: "Timed out", retryable: true, kind: "site" },
    });
    expect(result.ok && result.body.task).toMatchObject({
      status: "queued",
      failureKind: "site",
      lastError: "Timed out",
    });
  });

  it("never retries a recipe failure", async () => {
    const request = formRequest();
    const task = (await claim()) as ClaimedTask;
    expect(task.kind).toBe("form");
    const result = await ctx.call(API_ROUTES.workerTaskFail, {
      params: { id: task.id },
      body: {
        workerId: "worker-1",
        error: "Selector gone",
        retryable: true,
        kind: "recipe",
        step: 2,
      },
    });
    expect(result.ok && result.body.task).toMatchObject({
      status: "failed",
      failureKind: "recipe",
      failureStep: 2,
    });
    expect(request.id).toBeDefined();
  });

  it("hands a task back without costing an attempt, optionally holding it for a while", async () => {
    queueScan();
    const task = (await claim()) as ClaimedTask;
    const result = await ctx.call(API_ROUTES.workerTaskRelease, {
      params: { id: task.id },
      body: { workerId: "worker-1", retryAfterMs: 30_000 },
    });
    expect(result.ok && result.body.task).toMatchObject({ status: "queued", attempts: 0 });
    expect(await claim()).toBeNull();
    ctx.clock.advance(31_000);
    expect((await claim())?.id).toBe(task.id);
  });

  it("hands a task back at once when no delay is given", async () => {
    queueScan();
    const task = (await claim()) as ClaimedTask;
    await ctx.call(API_ROUTES.workerTaskRelease, {
      params: { id: task.id },
      body: { workerId: "worker-1" },
    });
    expect((await claim())?.id).toBe(task.id);
  });

  it("cannot report on a task an MCP client holds", async () => {
    const target = seedTarget(ctx, { category: "people-search" });
    ctx.services.dispatch.enqueueScan(profileId, target.id);
    const task = ctx.services.taskQueue.claim({
      workerId: "worker-1",
      kinds: ["agent"],
      leaseMs: 60_000,
      claimerKind: "mcp",
    });
    expect(task).not.toBeNull();
    const result = await ctx.call(API_ROUTES.workerTaskComplete, {
      params: { id: task?.id as string },
      body: { workerId: "worker-1", result: { purpose: "scan", scan: { candidates: [] } } },
    });
    expect(result.ok || result.body.error).toBe("lease_not_held");
  });
});

function formRequest() {
  const profile = seedProfile(ctx);
  seedMailbox(ctx, profile.id);
  const target = seedTarget(ctx, { contactMethod: "form", privacyEmail: null });
  seedRecipe(ctx, target.id, { purpose: "remove" });
  const request = seedRequest(ctx, {
    profileId: profile.id,
    targetId: target.id,
    channel: "form",
    status: "queued",
  });
  ctx.services.dispatch.dispatchRequest(request.id);
  return request;
}

describe("decodeScreenshot", () => {
  it("decodes a PNG and a JPEG", () => {
    expect(
      decodeScreenshot({ mime: "image/png", dataBase64: PNG.toString("base64") }).data,
    ).toEqual(PNG);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(
      decodeScreenshot({ mime: "image/jpeg", dataBase64: jpeg.toString("base64") }).data,
    ).toEqual(jpeg);
  });

  it("refuses text that is not base64, even though Node would decode it", () => {
    for (const dataBase64 of ["abc", "ab cd", "a\nbcd", "====", "YWJj!"]) {
      expect(() => decodeScreenshot({ mime: "image/png", dataBase64 }), dataBase64).toThrow(
        /base64/,
      );
    }
  });

  it("refuses bytes that are not the declared type", () => {
    expect(() =>
      decodeScreenshot({ mime: "image/jpeg", dataBase64: PNG.toString("base64") }),
    ).toThrow(/image\/jpeg/);
  });
});

describe("a lapsed holder reporting on a scan after its last lease expired", () => {
  const LEASE_MS = 60_000;
  const GRACE_MS = 10 * 60 * 1000;

  /** Claims and abandons the task until its attempts are spent and the expiry failure is recorded. */
  async function letEveryLeaseExpire(kinds: string[]) {
    let claimed: ClaimedTask | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      ctx.clock.advance(GRACE_MS);
      claimed = (await claim({ kinds, leaseMs: LEASE_MS })) as ClaimedTask;
      expect(claimed).not.toBeNull();
      ctx.clock.advance(LEASE_MS + 1);
      ctx.services.taskQueue.reapExpiredLeases();
    }
    return claimed as ClaimedTask;
  }

  const scanOfTask = (taskId: string) =>
    ctx.services.db.select().from(scans).where(eq(scans.taskId, taskId)).get();
  const allMatches = () => ctx.services.db.select().from(matches).all();

  function candidatesOn(domain: string) {
    return [{ recordUrl: `https://${domain}/p/jordan`, name: "Jordan Example", locations: [] }];
  }

  it("lets a late scan result replace the expiry failure and create matches", async () => {
    const target = queueScan();
    const task = await letEveryLeaseExpire(["scan"]);
    expect(scanOfTask(task.id)).toMatchObject({ error: "The lease expired" });
    expect(allMatches()).toHaveLength(0);

    const late = await ctx.call(API_ROUTES.workerTaskComplete, {
      params: { id: task.id },
      body: { workerId: "worker-1", result: { candidates: candidatesOn(target.domain) } },
    });
    expect(late.ok).toBe(true);
    expect(scanOfTask(task.id)).toMatchObject({ error: null, finishedAt: expect.any(String) });
    expect(allMatches()).toHaveLength(1);
  });

  it("lets a late agent scan result replace the expiry failure and create matches", async () => {
    const target = seedTarget(ctx, { category: "people-search" });
    ctx.services.dispatch.enqueueScan(profileId, target.id);
    const task = await letEveryLeaseExpire(["agent"]);
    expect(scanOfTask(task.id)).toMatchObject({ error: "The lease expired" });

    const late = await ctx.call(API_ROUTES.workerTaskComplete, {
      params: { id: task.id },
      body: {
        workerId: "worker-1",
        result: { purpose: "scan", scan: { candidates: candidatesOn(target.domain) } },
      },
    });
    expect(late.ok).toBe(true);
    expect(scanOfTask(task.id)).toMatchObject({ error: null, finishedAt: expect.any(String) });
    expect(allMatches()).toHaveLength(1);
  });

  it("keeps the failure visible when a rescan already holds the work a late recipe failure would hand over", async () => {
    const target = queueScan();
    const task = await letEveryLeaseExpire(["scan"]);
    const original = scanOfTask(task.id);
    ctx.services.dispatch.enqueueScan(profileId, target.id);

    const failed = await ctx.call(API_ROUTES.workerTaskFail, {
      params: { id: task.id },
      body: { workerId: "worker-1", error: "selector gone", retryable: false, kind: "recipe" },
    });
    expect(failed.ok).toBe(true);
    const row = ctx.services.db.select().from(scans).where(eq(scans.id, original?.id ?? "")).get();
    expect(row?.error).toEqual(expect.any(String));
    expect(row?.finishedAt).toEqual(expect.any(String));
  });

  it("hands a late recipe failure to an agent whose result lands", async () => {
    const target = queueScan();
    const task = await letEveryLeaseExpire(["scan"]);

    const failed = await ctx.call(API_ROUTES.workerTaskFail, {
      params: { id: task.id },
      body: { workerId: "worker-1", error: "selector gone", retryable: false, kind: "recipe" },
    });
    expect(failed.ok).toBe(true);
    const handedOver = ctx.services.db.select().from(scans).get();
    expect(handedOver).toMatchObject({ error: null, finishedAt: null });
    expect(ctx.services.taskQueue.getOrThrow(handedOver?.taskId as string)).toMatchObject({
      kind: "agent",
      status: "queued",
    });

    ctx.clock.advance(GRACE_MS);
    const agent = (await claim({ workerId: "agent-1", kinds: ["agent"] })) as ClaimedTask;
    const done = await ctx.call(API_ROUTES.workerTaskComplete, {
      params: { id: agent.id },
      body: {
        workerId: "agent-1",
        result: { purpose: "scan", scan: { candidates: candidatesOn(target.domain) } },
      },
    });
    expect(done.ok).toBe(true);
    expect(scanOfTask(agent.id)).toMatchObject({ error: null, finishedAt: expect.any(String) });
    expect(allMatches()).toHaveLength(1);
  });
});
