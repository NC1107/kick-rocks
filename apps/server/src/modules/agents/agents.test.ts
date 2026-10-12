import { API_ROUTES, type ModelIdentity, type TaskSummary } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunners } from "../../runners/index.js";
import { createScheduler } from "../../scheduler/scheduler.js";
import {
  createTestContext,
  DAY,
  MINUTE,
  seedClaimer,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedTarget,
  seedTask,
  type TestContext,
} from "../../test-utils/index.js";

let ctx: TestContext;
let profileId: string;

const MODEL: ModelIdentity = {
  provider: "ollama",
  name: "gpt-oss:20b",
  version: "sha-one",
  thinking: "default",
  numCtx: 16_384,
};

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
});

afterEach(async () => {
  await ctx.close();
});

function agentPayload(targetId: string, purpose: "scan" | "remove" = "scan") {
  return {
    purpose,
    profileId,
    targetId,
    requestId: null,
    recordUrl: null,
    variant: null,
    rights: [],
    reason: "no_recipe" as const,
    previousError: null,
    blockedReason: null,
  };
}

function agentTask(
  targetId: string,
  requestId: string | null = null,
  purpose: "scan" | "remove" = "scan",
) {
  return seedTask(ctx, {
    kind: "agent",
    dedupeKey: `agent:${targetId}:${requestId ?? purpose}:${Math.random()}`,
    payload: agentPayload(targetId, purpose),
    profileId,
    targetId,
    requestId,
  });
}

const assign = (
  taskId: string,
  body: Parameters<typeof ctx.call<typeof API_ROUTES.taskAssign>>[1],
) => ctx.call(API_ROUTES.taskAssign, { params: { id: taskId }, ...body });

const agents = (taskId?: string) =>
  ctx.call(API_ROUTES.agentsList, { query: taskId ? { taskId } : {} });

describe("GET /agents", () => {
  it("lists agent workers and MCP clients seen in the last week, never the recipe worker", async () => {
    seedClaimer(ctx, { kind: "builtin", workerId: "recipes" });
    seedClaimer(ctx, { kind: "model", workerId: "nick-pc-agent", model: MODEL, agoMs: MINUTE });
    seedClaimer(ctx, { kind: "model", workerId: "old-agent", model: MODEL, agoMs: 8 * DAY });
    seedClaimer(ctx, { kind: "mcp", workerId: "desk-client", agoMs: 5 * MINUTE });
    seedClaimer(ctx, { kind: "mcp", workerId: "stale-client", agoMs: 30 * MINUTE });

    const result = await agents();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.agents.map((a) => [a.kind, a.workerId, a.online])).toEqual([
      ["model", "nick-pc-agent", true],
      ["mcp", "desk-client", true],
      ["mcp", "stale-client", false],
    ]);
    expect(result.body.agents[0]?.gate).toMatchObject({ state: "unproven", unattended: false });
    expect(result.body.agents[1]?.gate).toBeNull();
    expect(result.body.mcpEnabled).toBe(ctx.services.settings.get("mcp.enabled"));
  });

  it("says what each agent is busy with, and that an agent worker that went quiet is not online", async () => {
    const target = seedTarget(ctx);
    const task = agentTask(target.id);
    seedClaimer(ctx, {
      kind: "model",
      workerId: "busy-agent",
      model: MODEL,
      busy: true,
      currentTaskId: task.id,
    });
    seedClaimer(ctx, { kind: "model", workerId: "quiet-agent", model: MODEL, agoMs: 10 * MINUTE });
    const result = await agents();
    if (!result.ok) throw new Error("agents failed");
    const byId = new Map(result.body.agents.map((a) => [a.workerId, a]));
    expect(byId.get("busy-agent")).toMatchObject({
      busy: true,
      currentTargetName: target.name,
      online: true,
    });
    expect(byId.get("quiet-agent")).toMatchObject({ online: false, busy: false });
  });

  it("gives the reason an agent would be refused a named task", async () => {
    const unreviewed = seedTarget(ctx);
    seedRecipe(ctx, unreviewed.id, { purpose: "scan", status: "pending_review" });
    const task = agentTask(unreviewed.id);
    seedClaimer(ctx, { kind: "model", workerId: "nick-pc-agent", model: MODEL });
    seedClaimer(ctx, { kind: "mcp", workerId: "desk-client" });

    const result = await agents(task.id);
    if (!result.ok) throw new Error("agents failed");
    const byId = new Map(result.body.agents.map((a) => [a.workerId, a]));
    expect(byId.get("nick-pc-agent")?.refusal).toMatchObject({
      code: "unreviewed",
      message: "The agent worker leaves sites whose recipe waits for your review.",
      settingsPath: "/settings/agents",
    });
    expect(byId.get("desk-client")?.refusal).toBeNull();
  });
});

describe("POST /tasks/:id/assign", () => {
  it("refuses an MCP client while MCP access is off, in the list and on assign", async () => {
    const task = agentTask(seedTarget(ctx).id);
    seedClaimer(ctx, { kind: "mcp", workerId: "desk-client" });
    ctx.services.settings.set("mcp.enabled", false);

    const listed = await agents(task.id);
    if (!listed.ok) throw new Error("agents failed");
    expect(listed.body.agents[0]?.refusal).toMatchObject({
      code: "mcp_off",
      settingsPath: "/settings/agents",
    });
    const refused = await assign(task.id, {
      body: { to: { kind: "mcp", workerId: "desk-client" } },
    });
    expect(refused.status).toBe(409);
    expect(refused.ok ? null : refused.body.error).toBe("assignee_cannot_take");
  });

  it("will not give a task kept for the person to an agent when a bot check stopped it", async () => {
    const target = seedTarget(ctx);
    const task = seedTask(ctx, {
      kind: "agent",
      dedupeKey: `agent:${target.id}:kept`,
      payload: {
        ...agentPayload(target.id, "remove"),
        reason: "blocked",
        blockedReason: "captcha",
      },
      profileId,
      targetId: target.id,
    });
    await assign(task.id, { body: { to: "person" } });

    for (const to of ["any", { kind: "model", workerId: "nick-pc-agent" }] as const) {
      const refused = await assign(task.id, { body: { to } });
      expect(refused.status).toBe(409);
      expect(refused.ok ? null : refused.body.error).toBe("person_only_block");
    }
    expect(ctx.services.taskQueue.getOrThrow(task.id).assignment?.to).toEqual({ kind: "person" });
  });

  it("names an agent, writes it on the timeline, and leaves the gate alone", async () => {
    const target = seedTarget(ctx);
    const request = seedRequest(ctx, { profileId, targetId: target.id });
    const task = agentTask(target.id, request.id);

    const result = await assign(task.id, {
      body: { to: { kind: "model", workerId: "nick-pc-agent" }, fallback: "person" },
    });

    expect(result.ok).toBe(true);
    const stored = ctx.services.taskQueue.getOrThrow(task.id);
    expect(stored.assignment).toMatchObject({
      to: { kind: "model", workerId: "nick-pc-agent" },
      by: "user",
      fallback: "person",
    });
    expect(stored.submitApproval).toBeNull();
    const events = ctx.services.requests.events(request.id);
    expect(events.map((event) => event.type)).toContain("task_assigned");
  });

  it("keeps a task for the person, and gives it back to any agent", async () => {
    const task = agentTask(seedTarget(ctx).id);
    await assign(task.id, { body: { to: "person" } });
    expect(ctx.services.taskQueue.getOrThrow(task.id).assignment?.to).toEqual({ kind: "person" });
    const back = await assign(task.id, { body: { to: "any" } });
    expect(back.ok && (back.body.task as TaskSummary).assignment).toBeNull();
  });

  it("refuses an agent worker for a site whose recipe waits for review, until the person allows it", async () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { purpose: "scan", status: "pending_review" });
    const task = agentTask(target.id);
    const body = { to: { kind: "model" as const, workerId: "nick-pc-agent" } };

    const refused = await assign(task.id, { body });
    expect(refused.status).toBe(409);
    expect(refused.ok ? null : refused.body.error).toBe("assignee_cannot_take");
    expect(refused.ok ? null : refused.body.message).toBe(
      "The agent worker leaves sites whose recipe waits for your review.",
    );
    expect(ctx.services.taskQueue.getOrThrow(task.id).assignment).toBeNull();

    const mcp = await assign(task.id, {
      body: { to: { kind: "mcp", workerId: "desk-client" } },
    });
    expect(mcp.ok).toBe(true);

    ctx.services.settings.set("agent.takeUnreviewed", true);
    expect((await assign(task.id, { body })).ok).toBe(true);
  });

  it("refuses an agent worker for a site whose recipe the person rejected", async () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { purpose: "scan", status: "rejected" });
    const task = agentTask(target.id);
    const refused = await assign(task.id, {
      body: { to: { kind: "model", workerId: "nick-pc-agent" } },
    });
    expect(refused.ok ? null : refused.body.message).toBe("You rejected the recipe for this site.");
  });

  it("refuses an MCP client for a site that goes through a proxy", async () => {
    const target = seedTarget(ctx, { domain: "routed.test" });
    const task = agentTask(target.id);
    await ctx.call(API_ROUTES.settingsPatch, {
      body: { egress: { proxyUrl: "http://10.0.0.100:8888", domains: ["routed.test"] } },
    });
    const refused = await assign(task.id, {
      body: { to: { kind: "mcp", workerId: "desk-client" } },
    });
    expect(refused.status).toBe(409);
    expect(refused.ok ? null : refused.body.error).toBe("assignee_cannot_take");
    expect(refused.ok ? null : refused.body.message).toBe(
      "This site goes through a proxy, which an MCP client cannot use.",
    );
    const worker = await assign(task.id, {
      body: { to: { kind: "model", workerId: "nick-pc-agent" } },
    });
    expect(worker.ok).toBe(true);
  });

  it("refuses a task that is running or blocked, and one that is not an agent task", async () => {
    const target = seedTarget(ctx);
    const body = { to: { kind: "mcp" as const, workerId: "desk-client" } };
    const running = seedTask(ctx, {
      kind: "agent",
      status: "leased",
      payload: agentPayload(target.id),
      profileId,
      targetId: target.id,
    });
    const blocked = seedTask(ctx, {
      kind: "agent",
      status: "blocked",
      payload: agentPayload(target.id),
      profileId,
      targetId: target.id,
    });
    const email = seedTask(ctx, {
      kind: "email_send",
      payload: { requestId: "r", kind: "initial", fields: [], inReplyTo: null },
    });
    const code = async (id: string) => {
      const result = await assign(id, { body });
      return result.ok ? null : result.body.error;
    };
    expect(await code(running.id)).toBe("task_running");
    expect(await code(blocked.id)).toBe("invalid_task_state");
    expect(await code(email.id)).toBe("not_assignable");
  });
});

describe("POST /tasks/:id/run-now", () => {
  const runNow = (taskId: string) => ctx.call(API_ROUTES.taskRunNow, { params: { id: taskId } });

  function retrying(workerId = "nick-pc-agent") {
    const target = seedTarget(ctx);
    const task = agentTask(target.id);
    ctx.services.taskQueue.assign(task.id, {
      to: { kind: "model", workerId },
      at: ctx.clock.now().toISOString(),
      by: "user",
      fallback: "any",
    });
    ctx.services.taskQueue.claim({
      workerId,
      kinds: ["agent"],
      leaseMs: 60_000,
      claimerKind: "model",
    });
    ctx.services.taskQueue.fail(task.id, {
      workerId,
      error: "network",
      retryable: true,
      kind: "network",
      actor: "worker",
    });
    return task;
  }

  it("clears a retry wait for an assigned agent worker that is online", async () => {
    const task = retrying();
    seedClaimer(ctx, { kind: "model", workerId: "nick-pc-agent", model: MODEL });
    expect(ctx.services.taskQueue.getOrThrow(task.id).runAfter).not.toBeNull();

    const result = await runNow(task.id);

    expect(result.ok && result.body.waiting).toBeNull();
    expect(ctx.services.taskQueue.getOrThrow(task.id).runAfter).toBeNull();
  });

  it("refuses when the assigned agent worker is offline, or the assignee is an MCP client", async () => {
    const task = retrying();
    seedClaimer(ctx, {
      kind: "model",
      workerId: "nick-pc-agent",
      model: MODEL,
      agoMs: 10 * MINUTE,
    });
    const offline = await runNow(task.id);
    expect(offline.ok ? null : offline.body.error).toBe("no_agent_online");

    ctx.services.taskQueue.assign(task.id, {
      to: { kind: "mcp", workerId: "desk-client" },
      at: ctx.clock.now().toISOString(),
      by: "user",
      fallback: "any",
    });
    const mcp = await runNow(task.id);
    expect(mcp.ok ? null : mcp.body.error).toBe("mcp_pulls");
  });

  it("takes any online agent worker for an unassigned task", async () => {
    const task = retrying();
    ctx.services.taskQueue.assign(task.id, null);
    expect((await runNow(task.id)).ok).toBe(false);
    seedClaimer(ctx, { kind: "model", workerId: "someone", model: MODEL });
    expect((await runNow(task.id)).ok).toBe(true);
  });

  it("does not lift the wait that guards a lease that ran out", async () => {
    const target = seedTarget(ctx);
    const task = agentTask(target.id);
    seedClaimer(ctx, { kind: "model", workerId: "nick-pc-agent", model: MODEL });
    ctx.services.taskQueue.claim({
      workerId: "nick-pc-agent",
      kinds: ["agent"],
      leaseMs: 60_000,
      claimerKind: "model",
    });
    ctx.clock.advance(5 * MINUTE);
    ctx.services.taskQueue.reapExpiredLeases();
    seedClaimer(ctx, { kind: "model", workerId: "nick-pc-agent", model: MODEL });

    const refused = await runNow(task.id);

    expect(refused.status).toBe(409);
    expect(refused.ok ? null : refused.body.error).toBe("site_waiting");
    expect(ctx.services.taskQueue.getOrThrow(task.id).runAfter).not.toBeNull();
  });

  it("refuses during a restore hold", async () => {
    const target = seedTarget(ctx);
    const task = agentTask(target.id, null, "remove");
    seedClaimer(ctx, { kind: "model", workerId: "nick-pc-agent", model: MODEL });
    const holding = ctx.services.restoreGate.holding;
    ctx.services.restoreGate.holding = () => true;
    const refused = await runNow(task.id);
    ctx.services.restoreGate.holding = holding;
    expect(refused.ok ? null : refused.body.error).toBe("restore_hold");
  });
});

describe("POST /tasks/:id/hand-off", () => {
  it("hands a blocked task to the agent the person picked, and keeps the old assignment otherwise", async () => {
    const target = seedTarget(ctx);
    const blocked = seedTask(ctx, {
      kind: "agent",
      status: "blocked",
      blockedReason: "login_required",
      dedupeKey: "agent:blocked-one",
      payload: agentPayload(target.id),
      profileId,
      targetId: target.id,
      assignment: {
        to: { kind: "model", workerId: "nick-pc-agent" },
        at: "2026-01-01T00:00:00.000Z",
        by: "user",
        fallback: "any",
      },
    });
    const kept = await ctx.call(API_ROUTES.taskHandOff, { params: { id: blocked.id } });
    expect(kept.ok && (kept.body.task as TaskSummary).assignment?.to).toEqual({
      kind: "model",
      workerId: "nick-pc-agent",
    });

    const second = seedTask(ctx, {
      kind: "agent",
      status: "blocked",
      blockedReason: "login_required",
      dedupeKey: "agent:blocked-two",
      payload: agentPayload(target.id),
      profileId,
      targetId: target.id,
    });
    const picked = await ctx.call(API_ROUTES.taskHandOff, {
      params: { id: second.id },
      body: { to: { kind: "mcp", workerId: "desk-client" }, fallback: "person" },
    });
    expect(picked.ok && (picked.body.task as TaskSummary).assignment).toMatchObject({
      to: { kind: "mcp", workerId: "desk-client" },
      fallback: "person",
    });
  });
});

describe("a task the person keeps, and an agent that goes quiet, end to end", () => {
  it("is kept out of every claim, listed under the person's own work, and closed by marking it done", async () => {
    const target = seedTarget(ctx);
    const request = seedRequest(ctx, { profileId, targetId: target.id });
    const task = agentTask(target.id, request.id, "remove");

    expect((await assign(task.id, { body: { to: "person" } })).ok).toBe(true);

    const claim = await ctx.call(API_ROUTES.workerClaim, {
      body: { workerId: "any-agent", kinds: ["agent"], claimer: "model" },
    });
    expect(claim.ok && claim.body.task).toBeNull();
    const queue = await ctx.call(API_ROUTES.reviewQueue, { query: { profileId } });
    expect(queue.ok && queue.body.agentTasks.map((item) => item.task.assignment?.to)).toEqual([
      { kind: "person" },
    ]);
    const board = await ctx.call(API_ROUTES.dashboardGet, { params: { id: profileId } });
    expect(board.ok && board.body.attention).toMatchObject({ agentTasks: 0, yourAgentTasks: 1 });

    const done = await ctx.call(API_ROUTES.taskMarkDone, {
      params: { id: task.id },
      body: { result: { outcome: "submitted" } },
    });
    expect(done.ok && (done.body.task as TaskSummary).status).toBe("done");
  });

  it("goes back to the person after the grace, and the dashboard and attention say so", async () => {
    const scheduler = createScheduler(ctx.services, {
      runners: createRunners(ctx.services, { random: () => 0 }),
      housekeepingMs: 0,
      retentionMs: 0,
    });
    const target = seedTarget(ctx);
    const request = seedRequest(ctx, { profileId, targetId: target.id });
    const task = agentTask(target.id, request.id);
    await ctx.call(API_ROUTES.workerHeartbeat, {
      body: { workerId: "nick-pc-agent", busy: false, claimer: "model", model: MODEL },
    });
    await assign(task.id, {
      body: { to: { kind: "model", workerId: "nick-pc-agent" }, fallback: "person" },
    });

    ctx.clock.advance(29 * MINUTE);
    await scheduler.tick();
    expect(ctx.services.taskQueue.getOrThrow(task.id).assignment?.to.kind).toBe("model");

    ctx.clock.advance(2 * MINUTE);
    await scheduler.tick();
    await scheduler.stop();
    expect(ctx.services.taskQueue.getOrThrow(task.id).assignment).toMatchObject({
      to: { kind: "person" },
      by: "fallback",
      lapsedFrom: { kind: "model", workerId: "nick-pc-agent" },
    });
    const board = await ctx.call(API_ROUTES.dashboardGet, { params: { id: profileId } });
    expect(board.ok && board.body.attention).toMatchObject({ yourAgentTasks: 1 });
    const detail = await ctx.call(API_ROUTES.requestsGet, { params: { id: request.id } });
    expect(detail.ok && detail.body.events.map((event) => event.type)).toContain("task_assigned");
  });
});
