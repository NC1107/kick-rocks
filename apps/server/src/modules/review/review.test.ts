import { mailboxes, requests, targets } from "@kickrocks/db";
import {
  API_ROUTES,
  availableActions,
  type BlockedReason,
  type RouteBodyInput,
  type RouteDef,
} from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  DAY,
  seedMailbox,
  seedMatch,
  seedMessage,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedScan,
  seedTarget,
  seedTask,
  type TestContext,
} from "../../test-utils/index.js";

let ctx: TestContext;
let profileId: string;
let mailboxId: string;
let targetId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  mailboxId = seedMailbox(ctx, profileId).id;
  targetId = seedTarget(ctx, {
    domain: "records.test",
    category: "people-search",
    contactMethod: "form",
    optOutUrl: "https://records.test/optout",
    searchUrl: "https://records.test/search",
  }).id;
});

afterEach(async () => {
  await ctx.close();
});

const RECORD = "https://records.test/p/1";

const formPayload = (requestId: string) => ({
  requestId,
  targetId,
  recipeId: null,
  recordUrl: RECORD,
});

function formRequest(status: Parameters<typeof seedRequest>[1]["status"] = "queued") {
  return seedRequest(ctx, {
    profileId,
    targetId,
    channel: "form",
    status,
    recordUrl: RECORD,
    mailboxId,
  });
}

const queue = async (profile?: string) => {
  const result = await ctx.call(API_ROUTES.reviewQueue, {
    ...(profile ? { query: { profileId: profile } } : {}),
  });
  if (!result.ok) throw new Error(`review queue answered ${result.status}`);
  return result.body;
};

describe("GET /review", () => {
  it("is empty when nothing waits", async () => {
    expect(await queue()).toEqual({
      blockedTasks: [],
      matches: [],
      verifications: [],
      failedTasks: [],
      agentTasks: [],
      messages: [],
      waitingTasks: [],
    });
  });

  describe("agent tasks nobody has claimed", () => {
    function waitingAgentTask() {
      const request = formRequest();
      return {
        request,
        task: seedTask(ctx, {
          kind: "agent",
          payload: {
            purpose: "remove",
            profileId,
            targetId,
            requestId: request.id,
            recordUrl: RECORD,
            variant: null,
            rights: ["opt_out"],
            reason: "no_recipe",
            previousError: null,
            blockedReason: null,
          },
          profileId,
          targetId,
          requestId: request.id,
        }),
      };
    }

    it("lists a queued agent task with the way to finish it by hand", async () => {
      const { request, task } = waitingAgentTask();

      const { agentTasks, blockedTasks } = await queue(profileId);

      expect(blockedTasks).toEqual([]);
      expect(agentTasks).toHaveLength(1);
      expect(agentTasks[0]).toMatchObject({
        requestReference: request.reference,
        manualInstructions: expect.stringContaining("No agent has taken this"),
        url: RECORD,
        task: { id: task.id, kind: "agent", status: "queued" },
      });
    });

    it("stops listing it once an agent claims it", async () => {
      waitingAgentTask();
      ctx.services.taskQueue.claim({ workerId: "agent", kinds: ["agent"], leaseMs: 60_000 });
      expect((await queue(profileId)).agentTasks).toEqual([]);
    });

    it("lets a person finish it by hand", async () => {
      const { request, task } = waitingAgentTask();
      const result = await ctx.call(API_ROUTES.taskMarkDone, {
        params: { id: task.id },
        body: { result: { outcome: "submitted" } },
      });
      expect(result.ok && result.body.task.status).toBe("done");
      expect(ctx.services.requests.getOrThrow(request.id).status).toBe("awaiting_reply");
      expect((await queue(profileId)).agentTasks).toEqual([]);
    });
  });

  describe("blocked tasks", () => {
    it("says where to go and what to do, and that a screenshot exists", async () => {
      const request = formRequest();
      const task = seedTask(ctx, {
        kind: "form",
        payload: formPayload(request.id),
        status: "blocked",
        profileId,
        targetId,
        requestId: request.id,
        blockedReason: "captcha",
        blockedDetail: "reCAPTCHA on the form",
        blockedUrl: "https://records.test/optout/step2",
        screenshot: true,
      });

      const { blockedTasks } = await queue();

      expect(blockedTasks).toHaveLength(1);
      expect(blockedTasks[0]).toMatchObject({
        requestReference: request.reference,
        url: "https://records.test/optout/step2",
        manualInstructions: expect.stringContaining("solve the CAPTCHA"),
        task: {
          id: task.id,
          status: "blocked",
          blockedReason: "captcha",
          blockedDetail: "reCAPTCHA on the form",
          hasScreenshot: true,
          targetName: expect.any(String),
        },
      });
    });

    it.each<[BlockedReason, string]>([
      ["captcha", "solve the CAPTCHA"],
      ["phone_verification", "texts a code"],
      ["id_upload", "never uploads ID"],
      ["email_verification", "Check your inbox"],
      ["login_required", "sign in first"],
      ["bot_detection", "blocked the automated browser"],
      ["unknown", "finish the removal by hand"],
    ])("explains a %s block", async (blockedReason, words) => {
      seedTask(ctx, {
        kind: "scan",
        payload: { profileId, targetId, recipeId: null, variant: null },
        status: "blocked",
        profileId,
        targetId,
        blockedReason,
      });
      const { blockedTasks } = await queue();
      expect(blockedTasks[0]?.manualInstructions).toContain(words);
    });

    it("falls back from the stuck page to the record, then the opt-out page, then the search page", async () => {
      const request = formRequest();
      const blocked = (overrides: { blockedUrl?: string | null; requestId?: string | null }) =>
        seedTask(ctx, {
          kind: "form",
          payload: formPayload(request.id),
          status: "blocked",
          profileId,
          targetId,
          ...overrides,
        });
      blocked({ requestId: request.id });
      blocked({ requestId: null });
      const { blockedTasks } = await queue();
      expect(blockedTasks.map((item) => item.url).sort()).toEqual([
        "https://records.test/optout",
        RECORD,
      ]);

      const bare = seedTarget(ctx, { optOutUrl: null, searchUrl: "https://bare.test/search" });
      seedTask(ctx, {
        kind: "scan",
        payload: { profileId, targetId: bare.id, recipeId: null, variant: null },
        status: "blocked",
        profileId,
        targetId: bare.id,
      });
      expect((await queue()).blockedTasks.map((item) => item.url)).toContain(
        "https://bare.test/search",
      );
    });

    it("lists only the profile asked for", async () => {
      const other = seedProfile(ctx, { displayName: "Casey Example" });
      seedTask(ctx, {
        kind: "scan",
        payload: { profileId: other.id, targetId, recipeId: null, variant: null },
        status: "blocked",
        profileId: other.id,
        targetId,
      });
      expect((await queue(profileId)).blockedTasks).toHaveLength(0);
      expect((await queue(other.id)).blockedTasks).toHaveLength(1);
      expect((await queue()).blockedTasks).toHaveLength(1);
    });
  });

  describe("agent tasks finished by hand", () => {
    const queuedAgentRemoval = () => {
      const request = formRequest();
      const task = seedTask(ctx, {
        kind: "agent",
        payload: {
          purpose: "remove",
          profileId,
          targetId,
          requestId: request.id,
          recordUrl: RECORD,
          variant: null,
          rights: ["opt_out"],
          reason: "no_recipe",
          previousError: null,
          blockedReason: null,
        },
        status: "queued",
        profileId,
        targetId,
        requestId: request.id,
      });
      return { request, task };
    };

    it("lets the person finish one by hand, which settles the request", async () => {
      ctx.services.settings.set("mcp.enabled", false);
      const { request, task } = queuedAgentRemoval();
      const result = await ctx.call(API_ROUTES.taskMarkDone, {
        params: { id: task.id },
        body: { note: "Did it myself" },
      });
      expect(result.ok && result.body.task.status).toBe("done");
      expect(ctx.services.requests.getOrThrow(request.id).status).toBe("awaiting_reply");
      expect((await queue()).agentTasks).toHaveLength(0);
    });
  });

  describe("matches", () => {
    it("lists only records still waiting for a decision, with the target's name", async () => {
      const scan = seedScan(ctx, { profileId, targetId });
      const pending = seedMatch(ctx, { scanId: scan.id, profileId, targetId });
      seedMatch(ctx, { scanId: scan.id, profileId, targetId, decision: "mine" });
      seedMatch(ctx, { scanId: scan.id, profileId, targetId, decision: "not_mine" });

      const { matches } = await queue(profileId);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        id: pending.id,
        scanId: scan.id,
        decision: "pending",
        recordUrl: pending.recordUrl,
        fields: { name: "Jordan Example" },
        targetName: expect.stringContaining("Example Broker"),
      });
    });
  });

  describe("verifications", () => {
    it("lists a request that needs verification with the message that asked and what it asked for", async () => {
      const request = seedRequest(ctx, { profileId, targetId, status: "needs_verification" });
      seedMessage(ctx, {
        mailboxId,
        requestId: request.id,
        classification: "verification_required",
        requestedFields: ["date_of_birth"],
        receivedAt: "2026-10-01T00:00:00.000Z",
        reviewed: true,
      });
      const newest = seedMessage(ctx, {
        mailboxId,
        requestId: request.id,
        classification: "verification_required",
        requestedFields: ["date_of_birth", "street"],
        receivedAt: "2026-10-05T00:00:00.000Z",
        reviewed: true,
      });

      const { verifications } = await queue();

      expect(verifications).toHaveLength(1);
      expect(verifications[0]).toMatchObject({
        request: { id: request.id, status: "needs_verification", target: { id: targetId } },
        message: { id: newest.id, classification: "verification_required" },
        requestedFields: ["date_of_birth", "street"],
      });
    });

    it("leaves out a request with nothing for the person to approve", async () => {
      seedRequest(ctx, { profileId, targetId, status: "needs_verification" });
      expect((await queue()).verifications).toHaveLength(0);
    });

    it("leaves out requests in other statuses", async () => {
      const request = seedRequest(ctx, { profileId, targetId, status: "awaiting_reply" });
      seedMessage(ctx, {
        mailboxId,
        requestId: request.id,
        classification: "verification_required",
        requestedFields: ["street"],
      });
      expect((await queue()).verifications).toHaveLength(0);
    });
  });

  describe("failed tasks", () => {
    const failedForm = (requestId: string, overrides: { dedupeKey?: string } = {}) =>
      seedTask(ctx, {
        kind: "form",
        payload: formPayload(requestId),
        status: "failed",
        profileId,
        targetId,
        requestId,
        lastError: "site down",
        failureKind: "site",
        ...overrides,
      });

    it("lists a task that failed for good while its request is open", async () => {
      const request = formRequest();
      const task = failedForm(request.id);
      const { failedTasks } = await queue();
      expect(failedTasks).toHaveLength(1);
      expect(failedTasks[0]).toMatchObject({
        task: { id: task.id, status: "failed", lastError: "site down", failureKind: "site" },
        requestReference: request.reference,
        manualInstructions: expect.stringContaining("Retry it"),
      });
    });

    it("leaves out a task whose request has been settled", async () => {
      failedForm(formRequest("confirmed").id);
      failedForm(formRequest("rejected").id);
      failedForm(formRequest("cancelled").id);
      expect((await queue()).failedTasks).toHaveLength(0);
    });

    it("words the steps for a failed scan without a mark-done button", async () => {
      seedTask(ctx, {
        kind: "scan",
        payload: { profileId, targetId, recipeId: null, variant: null },
        status: "failed",
        profileId,
        targetId,
        lastError: "boom",
        failureKind: "network",
      });
      const { failedTasks } = await queue();
      expect(failedTasks[0]?.manualInstructions).toContain("This scan failed");
      expect(failedTasks[0]?.manualInstructions).not.toContain("mark it done");
    });

    it("keeps a failed scan, which has no request to settle", async () => {
      seedTask(ctx, {
        kind: "scan",
        payload: { profileId, targetId, recipeId: null, variant: null },
        status: "failed",
        profileId,
        targetId,
        lastError: "no results page",
      });
      expect((await queue()).failedTasks).toHaveLength(1);
    });

    it("forgets a failure after 30 days", async () => {
      failedForm(formRequest().id);
      ctx.clock.advance(29 * DAY);
      expect((await queue()).failedTasks).toHaveLength(1);
      ctx.clock.advance(2 * DAY);
      expect((await queue()).failedTasks).toHaveLength(0);
    });

    it("leaves out a failure that newer work has taken over", async () => {
      const request = formRequest();
      failedForm(request.id, { dedupeKey: `form:${request.id}` });
      expect((await queue()).failedTasks).toHaveLength(1);
      seedTask(ctx, {
        kind: "agent",
        payload: {
          purpose: "remove",
          profileId,
          targetId,
          requestId: request.id,
          recordUrl: RECORD,
          variant: null,
          rights: ["opt_out"],
          reason: "recipe_failed",
          previousError: null,
          blockedReason: null,
        },
        status: "done",
        profileId,
        targetId,
        requestId: request.id,
        dedupeKey: `form:${request.id}`,
        result: { purpose: "remove", form: { outcome: "submitted" } },
      });
      expect((await queue()).failedTasks).toHaveLength(0);
    });

    it("leaves out a failed poll or canary, which a person cannot act on", async () => {
      seedTask(ctx, {
        kind: "inbox_poll",
        payload: { mailboxId },
        status: "failed",
        profileId,
        lastError: "IMAP down",
      });
      seedTask(ctx, { kind: "canary", payload: { recipeId: "x" }, status: "failed" });
      expect((await queue()).failedTasks).toHaveLength(0);
    });
  });

  describe("messages", () => {
    it("lists unreviewed mail, newest first, with its request and target", async () => {
      const request = seedRequest(ctx, { profileId, targetId, status: "awaiting_reply" });
      const older = seedMessage(ctx, { mailboxId, receivedAt: "2026-10-01T00:00:00.000Z" });
      const newer = seedMessage(ctx, {
        mailboxId,
        requestId: request.id,
        receivedAt: "2026-10-02T00:00:00.000Z",
        confidence: 0.4,
      });
      seedMessage(ctx, { mailboxId, reviewed: true });

      const { messages } = await queue(profileId);

      expect(messages.map((message) => message.id)).toEqual([newer.id, older.id]);
      expect(messages[0]).toMatchObject({
        requestReference: request.reference,
        targetName: expect.stringContaining("Example Broker"),
        confidence: 0.4,
        reviewed: false,
      });
      expect(messages[1]).toMatchObject({ requestReference: null, targetName: null });
    });

    it("lists only the mail of the profile asked for", async () => {
      const other = seedProfile(ctx, { displayName: "Casey Example" });
      const otherBox = seedMailbox(ctx, other.id, { address: "casey@example.org" });
      seedMessage(ctx, { mailboxId });
      seedMessage(ctx, { mailboxId: otherBox.id });
      expect((await queue(profileId)).messages).toHaveLength(1);
      expect((await queue()).messages).toHaveLength(2);
    });
  });
});

describe("task actions", () => {
  const blockedForm = () => {
    const request = formRequest();
    const task = seedTask(ctx, {
      kind: "form",
      payload: formPayload(request.id),
      status: "blocked",
      profileId,
      targetId,
      requestId: request.id,
      blockedReason: "captcha",
    });
    return { request, task };
  };
  const call = <R extends RouteDef>(route: R, id: string) => ctx.call(route, { params: { id } });

  describe("resume", () => {
    it("puts a blocked task back in the queue and records it on the request", async () => {
      const { request, task } = blockedForm();
      const result = await call(API_ROUTES.taskResume, task.id);
      expect(result.ok && result.body.task).toMatchObject({ id: task.id, status: "queued" });
      expect(
        ctx.services.requests.events(request.id).find((event) => event.type === "task_resumed"),
      ).toMatchObject({ actor: "system" });
    });

    it("refuses a task that is not blocked", async () => {
      const task = seedTask(ctx, {
        kind: "canary",
        payload: { recipeId: "x" },
      });
      expect(await call(API_ROUTES.taskResume, task.id)).toMatchObject({
        ok: false,
        status: 409,
        body: { error: "invalid_task_state" },
      });
    });

    it("answers 404 for an unknown task", async () => {
      expect(await call(API_ROUTES.taskResume, "nope")).toMatchObject({ ok: false, status: 404 });
    });
  });

  describe("cancel", () => {
    it("cancels a blocked task and leaves its request to be resent", async () => {
      const { request, task } = blockedForm();
      const result = await call(API_ROUTES.taskCancel, task.id);
      expect(result.ok && result.body.task.status).toBe("cancelled");
      const after = ctx.services.requests.getOrThrow(request.id);
      expect(
        availableActions(after, { hasLiveTask: ctx.services.taskQueue.hasLiveTask(request.id) }),
      ).toContain("resend");
    });

    it("dismisses a task that failed, so it leaves the queue", async () => {
      const request = formRequest();
      const task = seedTask(ctx, {
        kind: "form",
        payload: formPayload(request.id),
        status: "failed",
        profileId,
        targetId,
        requestId: request.id,
        lastError: "site down",
        failureKind: "site",
      });
      expect((await queue()).failedTasks).toHaveLength(1);

      const result = await call(API_ROUTES.taskCancel, task.id);

      expect(result.ok && result.body.task.status).toBe("cancelled");
      expect((await queue()).failedTasks).toHaveLength(0);
    });

    it("refuses a task that already finished", async () => {
      const task = seedTask(ctx, { kind: "canary", payload: { recipeId: "x" }, status: "done" });
      expect(await call(API_ROUTES.taskCancel, task.id)).toMatchObject({ ok: false, status: 409 });
    });
  });

  describe("mark done", () => {
    const markDone = (id: string, body: Record<string, unknown>) =>
      ctx.call(API_ROUTES.taskMarkDone, { params: { id }, body });

    it("counts a form finished by hand as submitted", async () => {
      const { request, task } = blockedForm();
      const result = await markDone(task.id, { note: "Did it myself" });
      expect(result.ok && result.body.task.status).toBe("done");
      expect(ctx.services.requests.getOrThrow(request.id).status).toBe("awaiting_reply");
    });

    it("applies the outcome the person reports", async () => {
      const { request, task } = blockedForm();
      await markDone(task.id, { result: { outcome: "not_found" } });
      expect(ctx.services.requests.getOrThrow(request.id).status).toBe("no_record");
    });

    it("rejects a result that does not fit the task", async () => {
      const { request, task } = blockedForm();
      const result = await markDone(task.id, { result: { candidates: [] } });
      expect(result).toMatchObject({ ok: false, status: 400, body: { error: "invalid_result" } });
      expect(ctx.services.requests.getOrThrow(request.id).status).toBe("queued");
      expect(ctx.services.taskQueue.getOrThrow(task.id).status).toBe("blocked");
    });

    it("takes the candidates a person found for a blocked scan", async () => {
      const { task, scanId } = ctx.services.dispatch.enqueueScan(profileId, targetId);
      ctx.services.taskQueue.claim({ workerId: "w", kinds: ["agent"], leaseMs: 60_000 });
      ctx.services.taskQueue.block(task.id, { workerId: "w", reason: "captcha", actor: "worker" });
      const result = await markDone(task.id, {
        result: { candidates: [{ recordUrl: RECORD, name: "Jordan Example", locations: [] }] },
      });
      expect(result.ok).toBe(true);
      const after = await queue(profileId);
      expect(after.matches).toHaveLength(1);
      expect(scanId).toBeTruthy();
    });

    it("refuses a task that is not blocked", async () => {
      const task = seedTask(ctx, { kind: "canary", payload: { recipeId: "x" } });
      expect(await markDone(task.id, {})).toMatchObject({ ok: false, status: 409 });
    });
  });

  describe("hand off", () => {
    it("gives a blocked scan to an agent that knows what stopped the worker", async () => {
      seedRecipe(ctx, targetId, { purpose: "scan" });
      const { task, scanId } = ctx.services.dispatch.enqueueScan(profileId, targetId);
      ctx.services.taskQueue.claim({ workerId: "w", kinds: ["scan"], leaseMs: 60_000 });
      ctx.services.taskQueue.block(task.id, {
        workerId: "w",
        reason: "bot_detection",
        actor: "worker",
      });

      const result = await call(API_ROUTES.taskHandOff, task.id);

      expect(result.ok && result.body.task).toMatchObject({ kind: "agent", status: "queued" });
      expect(ctx.services.taskQueue.getOrThrow(task.id).status).toBe("cancelled");
      const agent = ctx.services.taskQueue.getOrThrow(result.ok ? result.body.task.id : "");
      expect(agent.kind === "agent" && agent.payload).toMatchObject({
        reason: "blocked",
        blockedReason: "bot_detection",
      });
      const scans = await ctx.call(API_ROUTES.scansList, { params: { id: profileId } });
      expect(scans.ok && scans.body.items[0]).toMatchObject({ id: scanId, taskId: agent.id });
    });

    it("refuses a task that is not blocked", async () => {
      const queued = seedTask(ctx, {
        kind: "scan",
        payload: { profileId, targetId, recipeId: null, variant: null },
        profileId,
        targetId,
        dedupeKey: "scan:x",
      });
      expect(await call(API_ROUTES.taskHandOff, queued.id)).toMatchObject({
        ok: false,
        status: 409,
      });
    });

    it("refuses a kind an agent cannot take", async () => {
      const confirm = seedTask(ctx, {
        kind: "confirm",
        payload: { requestId: "r", url: "https://records.test/c" },
        status: "blocked",
      });
      expect(await call(API_ROUTES.taskHandOff, confirm.id)).toMatchObject({
        ok: false,
        status: 409,
        body: { error: "not_handoffable" },
      });
    });
  });

  describe("retry", () => {
    it("sends a failed email again and clears the error", async () => {
      const target = seedTarget(ctx);
      const request = seedRequest(ctx, {
        profileId,
        targetId: target.id,
        status: "queued",
        mailboxId,
        lastError: "connection reset",
      });
      const failed = seedTask(ctx, {
        kind: "email_send",
        payload: { requestId: request.id, kind: "initial", fields: [], inReplyTo: null },
        status: "failed",
        profileId,
        targetId: target.id,
        requestId: request.id,
        lastError: "connection reset",
        dedupeKey: `email_send:${request.id}`,
      });

      const result = await call(API_ROUTES.taskRetry, failed.id);

      expect(result.ok && result.body.task).toMatchObject({
        kind: "email_send",
        status: "queued",
        requestId: request.id,
      });
      expect(result.ok && result.body.task?.id).not.toBe(failed.id);
      expect(ctx.services.requests.getOrThrow(request.id).lastError).toBeNull();
      expect(
        ctx.services.requests.events(request.id).find((event) => event.type === "user_action"),
      ).toMatchObject({ actor: "user", payload: { action: "retry_task" } });
    });

    it("refuses to retry a failed site check while site checks are off, and retries it once on", async () => {
      const recipe = seedRecipe(ctx, targetId, { purpose: "scan" });
      const failed = seedTask(ctx, {
        kind: "canary",
        payload: { recipeId: recipe.id },
        status: "failed",
        dedupeKey: `canary:${recipe.id}`,
      });
      expect(await call(API_ROUTES.taskRetry, failed.id)).toMatchObject({
        ok: false,
        status: 409,
        body: { error: "site_checks_off" },
      });

      ctx.services.settings.set("auth.passwordHash", "hash");
      ctx.services.settings.set("siteChecks.enabled", true);
      const result = await call(API_ROUTES.taskRetry, failed.id);
      expect(result.ok && result.body.task).toMatchObject({ kind: "canary", status: "queued" });
    });

    it("keeps a verification reply a verification reply", async () => {
      const target = seedTarget(ctx);
      const request = seedRequest(ctx, {
        profileId,
        targetId: target.id,
        status: "queued",
        mailboxId,
      });
      const failed = seedTask(ctx, {
        kind: "email_send",
        payload: {
          requestId: request.id,
          kind: "verification_reply",
          fields: ["date_of_birth"],
          inReplyTo: "<broker-1@broker.test>",
        },
        status: "failed",
        profileId,
        targetId: target.id,
        requestId: request.id,
        dedupeKey: `email_send:${request.id}`,
      });
      const result = await call(API_ROUTES.taskRetry, failed.id);
      const retried = ctx.services.taskQueue.getOrThrow(
        result.ok ? (result.body.task?.id ?? "") : "",
      );
      expect(retried.kind === "email_send" && retried.payload).toMatchObject({
        kind: "verification_reply",
        fields: ["date_of_birth"],
        inReplyTo: "<broker-1@broker.test>",
      });
    });

    it("runs a failed form again", async () => {
      const request = formRequest();
      const failed = seedTask(ctx, {
        kind: "form",
        payload: formPayload(request.id),
        status: "failed",
        profileId,
        targetId,
        requestId: request.id,
        dedupeKey: `form:${request.id}`,
        failureKind: "site",
      });
      const result = await call(API_ROUTES.taskRetry, failed.id);
      expect(result.ok && result.body.task).toMatchObject({
        kind: "agent",
        status: "queued",
        requestId: request.id,
      });
    });

    it("scans again for a failed scan", async () => {
      seedRecipe(ctx, targetId, { purpose: "scan" });
      const failed = seedTask(ctx, {
        kind: "scan",
        payload: { profileId, targetId, recipeId: null, variant: null },
        status: "failed",
        profileId,
        targetId,
        dedupeKey: `scan:${profileId}:${targetId}`,
      });
      const result = await call(API_ROUTES.taskRetry, failed.id);
      expect(result.ok && result.body.task).toMatchObject({ kind: "scan", status: "queued" });
      const scans = await ctx.call(API_ROUTES.scansList, { params: { id: profileId } });
      expect(scans.ok && scans.body.total).toBe(1);
    });

    it("opens a failed confirmation again", async () => {
      const request = formRequest("awaiting_reply");
      const failed = seedTask(ctx, {
        kind: "confirm",
        payload: { requestId: request.id, url: "https://records.test/confirm?t=1" },
        status: "failed",
        profileId,
        targetId,
        requestId: request.id,
        dedupeKey: "confirm:failed",
      });
      const result = await call(API_ROUTES.taskRetry, failed.id);
      expect(result.ok && result.body.task).toMatchObject({ kind: "confirm", status: "queued" });
    });

    it("answers with no task when the request was settled in the meantime", async () => {
      const request = formRequest("confirmed");
      const failed = seedTask(ctx, {
        kind: "form",
        payload: formPayload(request.id),
        status: "failed",
        profileId,
        targetId,
        requestId: request.id,
      });
      const result = await call(API_ROUTES.taskRetry, failed.id);
      expect(result).toMatchObject({ ok: true, body: { task: null } });
    });

    it("refuses when the request is no longer waiting on this task", async () => {
      const request = formRequest("awaiting_reply");
      const failed = seedTask(ctx, {
        kind: "form",
        payload: formPayload(request.id),
        status: "failed",
        profileId,
        targetId,
        requestId: request.id,
      });
      expect(await call(API_ROUTES.taskRetry, failed.id)).toMatchObject({
        ok: false,
        status: 409,
        body: { error: "invalid_request_state" },
      });
    });

    it("refuses a task that did not fail", async () => {
      const task = seedTask(ctx, { kind: "canary", payload: { recipeId: "x" } });
      expect(await call(API_ROUTES.taskRetry, task.id)).toMatchObject({ ok: false, status: 409 });
    });

    it("takes the task out of the failed list", async () => {
      const request = formRequest();
      const failed = seedTask(ctx, {
        kind: "form",
        payload: formPayload(request.id),
        status: "failed",
        profileId,
        targetId,
        requestId: request.id,
        dedupeKey: `form:${request.id}`,
      });
      expect((await queue()).failedTasks).toHaveLength(1);
      await call(API_ROUTES.taskRetry, failed.id);
      expect((await queue()).failedTasks).toHaveLength(0);
    });
  });

  describe("screenshot", () => {
    it("serves the image with its type", async () => {
      const task = seedTask(ctx, {
        kind: "scan",
        payload: { profileId, targetId, recipeId: null, variant: null },
        status: "blocked",
        screenshot: true,
      });
      const result = await ctx.call(API_ROUTES.taskScreenshot, { params: { id: task.id } });
      expect(result.ok).toBe(true);
      expect(result.response.headers["content-type"]).toBe("image/png");
      expect(result.response.headers["cache-control"]).toContain("no-store");
      expect(result.response.rawPayload.subarray(1, 4).toString()).toBe("PNG");
    });

    it("answers 404 when the task has no screenshot or does not exist", async () => {
      const task = seedTask(ctx, { kind: "canary", payload: { recipeId: "x" } });
      expect(await ctx.call(API_ROUTES.taskScreenshot, { params: { id: task.id } })).toMatchObject({
        ok: false,
        status: 404,
      });
      expect(await ctx.call(API_ROUTES.taskScreenshot, { params: { id: "nope" } })).toMatchObject({
        ok: false,
        status: 404,
      });
    });
  });
});

describe("POST /matches/:id/decision", () => {
  const decide = (
    id: string,
    body: { decision: "mine" | "not_mine"; rights?: ("opt_out" | "delete")[] },
  ) => ctx.call(API_ROUTES.matchDecide, { params: { id }, body });

  function pendingMatch(recordUrl = RECORD) {
    const scan = seedScan(ctx, { profileId, targetId });
    return seedMatch(ctx, { scanId: scan.id, profileId, targetId, recordUrl });
  }

  it("opens a form removal for exactly that record with the rights the person chose", async () => {
    const match = pendingMatch();

    const result = await decide(match.id, { decision: "mine", rights: ["opt_out"] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      id: match.id,
      decision: "mine",
      decidedAt: ctx.clock.now().toISOString(),
      targetName: expect.any(String),
    });
    const request = ctx.services.requests.getOrThrow(result.body.requestId ?? "");
    expect(request).toMatchObject({
      status: "queued",
      channel: "form",
      recordUrl: RECORD,
      rights: ["opt_out"],
      profileId,
      targetId,
    });
    expect(ctx.services.taskQueue.hasLiveTask(request.id)).toBe(true);
    expect(
      ctx.services.requests.events(request.id).find((event) => event.type === "created"),
    ).toMatchObject({ actor: "user" });
  });

  it("asks for both rights unless told otherwise", async () => {
    const match = pendingMatch();
    const result = await decide(match.id, { decision: "mine" });
    const request = ctx.services.requests.getOrThrow(
      result.ok ? (result.body.requestId ?? "") : "",
    );
    expect(request.rights).toEqual(["opt_out", "delete"]);
  });

  it("records that a record is not theirs without opening anything", async () => {
    const match = pendingMatch();
    const result = await decide(match.id, { decision: "not_mine" });
    expect(result.ok && result.body).toMatchObject({ decision: "not_mine", requestId: null });
    expect(ctx.services.db.select().from(requests).all()).toHaveLength(0);
    expect((await queue()).matches).toHaveLength(0);
  });

  it("answers the same decision again without opening a second removal", async () => {
    const match = pendingMatch();
    const first = await decide(match.id, { decision: "mine" });
    const second = await decide(match.id, { decision: "mine" });
    expect(second.ok && second.body).toEqual(first.ok && first.body);
    expect(ctx.services.db.select().from(requests).all()).toHaveLength(1);
  });

  it("lets a person change their mind from not mine to mine", async () => {
    const match = pendingMatch();
    await decide(match.id, { decision: "not_mine" });
    const result = await decide(match.id, { decision: "mine" });
    expect(result.ok && result.body).toMatchObject({
      decision: "mine",
      requestId: expect.any(String),
    });
  });

  it("does not take back a removal that was opened", async () => {
    const match = pendingMatch();
    await decide(match.id, { decision: "mine" });
    expect(await decide(match.id, { decision: "not_mine" })).toMatchObject({
      ok: false,
      status: 409,
      body: { error: "match_already_decided" },
    });
  });

  it("joins the removal already in motion for the same record instead of opening another", async () => {
    const existing = seedRequest(ctx, {
      profileId,
      targetId,
      channel: "form",
      status: "awaiting_reply",
      recordUrl: "https://www.records.test/p/1/",
    });
    const match = pendingMatch();
    const result = await decide(match.id, { decision: "mine" });
    expect(result.ok && result.body.requestId).toBe(existing.id);
    expect(ctx.services.db.select().from(requests).all()).toHaveLength(1);
  });

  it("opens a new removal when the earlier one for the record is finished", async () => {
    seedRequest(ctx, {
      profileId,
      targetId,
      channel: "form",
      status: "confirmed",
      recordUrl: RECORD,
    });
    const match = pendingMatch();
    await decide(match.id, { decision: "mine" });
    expect(ctx.services.db.select().from(requests).all()).toHaveLength(2);
  });

  it("leaves the match undecided when the removal cannot be opened", async () => {
    ctx.services.db.delete(mailboxes).run();
    seedRecipe(ctx, targetId, { purpose: "remove" });
    const match = pendingMatch();

    const result = await decide(match.id, { decision: "mine" });

    expect(result).toMatchObject({ ok: false, status: 409, body: { error: "mailbox_required" } });
    expect((await queue()).matches.map((entry) => entry.id)).toEqual([match.id]);
    expect(ctx.services.db.select().from(requests).all()).toHaveLength(0);
  });

  it("refuses a target that left the dataset", async () => {
    const match = pendingMatch();
    ctx.services.db.update(targets).set({ retired: true }).where(eq(targets.id, targetId)).run();
    expect(await decide(match.id, { decision: "mine" })).toMatchObject({
      ok: false,
      status: 409,
      body: { error: "target_retired" },
    });
  });

  it("answers 404 for an unknown match and 400 for an unknown decision", async () => {
    expect(await decide("nope", { decision: "mine" })).toMatchObject({ ok: false, status: 404 });
    const response = await ctx.inject({
      method: "POST",
      url: `/api/matches/${pendingMatch().id}/decision`,
      payload: { decision: "maybe" },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("messages", () => {
  const classify = (id: string, body: RouteBodyInput<typeof API_ROUTES.messageClassify>) =>
    ctx.call(API_ROUTES.messageClassify, { params: { id }, body });

  async function awaitingRequest(overrides: Parameters<typeof seedTarget>[1] = {}) {
    const target = seedTarget(ctx, overrides);
    const { request } = ctx.services.requests.open({
      profileId,
      targetId: target.id,
      rights: ["opt_out"],
      channel: "email",
      actor: "user",
    });
    ctx.services.db
      .update(requests)
      .set({ status: "awaiting_reply" })
      .where(eq(requests.id, request.id))
      .run();
    ctx.services.taskQueue.cancelForRequest(request.id);
    return { target, request: ctx.services.requests.getOrThrow(request.id) };
  }

  describe("GET /messages/:id", () => {
    it("returns the whole message", async () => {
      const message = seedMessage(ctx, {
        mailboxId,
        text: "The full text of the broker's answer.",
        snippet: "The full text",
        links: ["https://broker.test/confirm"],
        requestedFields: ["street"],
      });
      const result = await ctx.call(API_ROUTES.messageGet, { params: { id: message.id } });
      expect(result.ok && result.body).toMatchObject({
        id: message.id,
        text: "The full text of the broker's answer.",
        snippet: "The full text",
        links: ["https://broker.test/confirm"],
        requestedFields: ["street"],
      });
    });

    it("answers 404 for an unknown message", async () => {
      expect(await ctx.call(API_ROUTES.messageGet, { params: { id: "nope" } })).toMatchObject({
        ok: false,
        status: 404,
      });
    });
  });

  describe("POST /messages/:id/classification", () => {
    it("applies the person's classification to the request, as the person", async () => {
      const { request } = await awaitingRequest();
      const message = seedMessage(ctx, { mailboxId, requestId: request.id });

      const result = await classify(message.id, { classification: "completed" });

      expect(result.ok && result.body).toMatchObject({
        id: message.id,
        classification: "completed",
        confidence: 1,
        reviewed: true,
        rationale: "Classified by hand",
      });
      expect(ctx.services.requests.getOrThrow(request.id).status).toBe("confirmed");
      expect(
        ctx.services.requests.events(request.id).find((event) => event.type === "classified"),
      ).toMatchObject({
        actor: "user",
        payload: { messageId: message.id, classification: "completed", correlation: "manual" },
      });
      expect((await queue()).messages).toHaveLength(0);
    });

    it("attaches a message nobody could place to the request the person names", async () => {
      const { request } = await awaitingRequest();
      const message = seedMessage(ctx, { mailboxId });

      const result = await classify(message.id, {
        classification: "rejected",
        requestId: request.id,
      });

      expect(result.ok && result.body.requestId).toBe(request.id);
      expect(ctx.services.requests.getOrThrow(request.id).status).toBe("rejected");
      const types = ctx.services.requests.events(request.id).map((event) => event.type);
      expect(types).toEqual(expect.arrayContaining(["reply_received", "classified"]));
    });

    it("moves a request to needs_verification only when the machine allows it", async () => {
      const { request } = await awaitingRequest();
      const message = seedMessage(ctx, {
        mailboxId,
        requestId: request.id,
        requestedFields: ["date_of_birth"],
      });
      await classify(message.id, { classification: "verification_required" });
      expect(ctx.services.requests.getOrThrow(request.id).status).toBe("needs_verification");
    });

    it("records a classification the machine will not apply", async () => {
      const { request } = await awaitingRequest();
      ctx.services.requests.transition(request.id, "no_record", { actor: "user" });
      const message = seedMessage(ctx, { mailboxId, requestId: request.id });
      const result = await classify(message.id, { classification: "completed" });
      expect(result.ok && result.body.classification).toBe("completed");
      expect(ctx.services.requests.getOrThrow(request.id).status).toBe("no_record");
    });

    it("sends a bounced request through the form when the person says it bounced", async () => {
      const { request } = await awaitingRequest({ contactMethod: "both" });
      const message = seedMessage(ctx, { mailboxId, requestId: request.id });
      await classify(message.id, { classification: "bounce" });
      expect(ctx.services.requests.getOrThrow(request.id)).toMatchObject({
        status: "queued",
        channel: "form",
      });
    });

    it("follows the link in a company's message the person says is a confirmation", async () => {
      const { request, target } = await awaitingRequest({ kind: "company" });
      const link = `https://${target.domain}/confirm?t=1`;
      const message = seedMessage(ctx, { mailboxId, requestId: request.id, links: [link] });
      await classify(message.id, { classification: "confirmation_link" });
      expect(ctx.mail.linkFollower.calls).toEqual([{ url: link, allowedDomains: [target.domain] }]);
      expect(
        ctx.services.requests.events(request.id).find((event) => event.type === "link_followed"),
      ).toMatchObject({ actor: "user", payload: { url: link, ok: true } });
    });

    it("marks mail reviewed even when it belongs to no request", async () => {
      const message = seedMessage(ctx, { mailboxId });
      const result = await classify(message.id, { classification: "unrelated" });
      expect(result.ok && result.body).toMatchObject({ reviewed: true, requestId: null });
    });

    it("lets the person detach a message from a request", async () => {
      const { request } = await awaitingRequest();
      const message = seedMessage(ctx, { mailboxId, requestId: request.id });
      const result = await classify(message.id, { classification: "unrelated", requestId: null });
      expect(result.ok && result.body.requestId).toBeNull();
      expect(ctx.services.requests.getOrThrow(request.id).status).toBe("awaiting_reply");
    });

    it("refuses a request that belongs to another profile", async () => {
      const other = seedProfile(ctx, { displayName: "Casey Example" });
      const target = seedTarget(ctx);
      const foreign = seedRequest(ctx, {
        profileId: other.id,
        targetId: target.id,
        status: "awaiting_reply",
      });
      const message = seedMessage(ctx, { mailboxId });
      expect(
        await classify(message.id, { classification: "completed", requestId: foreign.id }),
      ).toMatchObject({ ok: false, status: 409, body: { error: "request_mismatch" } });
      expect(ctx.services.requests.getOrThrow(foreign.id).status).toBe("awaiting_reply");
    });

    it("answers 404 for an unknown message or request", async () => {
      expect(await classify("nope", { classification: "unrelated" })).toMatchObject({
        ok: false,
        status: 404,
      });
      const message = seedMessage(ctx, { mailboxId });
      expect(
        await classify(message.id, { classification: "unrelated", requestId: "nope" }),
      ).toMatchObject({ ok: false, status: 404, body: { error: "request_not_found" } });
    });

    it("rejects a classification that does not exist", async () => {
      const message = seedMessage(ctx, { mailboxId });
      const response = await ctx.inject({
        method: "POST",
        url: `/api/messages/${message.id}/classification`,
        payload: { classification: "great_news" },
      });
      expect(response.statusCode).toBe(400);
    });
  });
});

describe("session", () => {
  it("is needed for every review route", async () => {
    ctx.auth.deny();
    for (const [method, url] of [
      ["GET", "/api/review"],
      ["POST", "/api/tasks/x/resume"],
      ["POST", "/api/matches/x/decision"],
      ["GET", "/api/messages/x"],
    ] as const) {
      const response = await ctx.inject({
        method,
        url,
        payload: method === "POST" ? {} : undefined,
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
