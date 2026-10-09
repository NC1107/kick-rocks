import {
  API_ROUTES,
  type ClaimedTask,
  GATE_RUNS_PER_SCENARIO,
  GATE_SCENARIOS,
  type GateEvidence,
  type ModelIdentity,
  type OutgoingRequest,
  type SendsBody,
} from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claimTask } from "../../core/claim.js";
import {
  createTestContext,
  seedMailbox,
  seedProfile,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../../test-utils/index.js";
import { createTaskOperations, MCP_CALLER } from "./task-operations.js";

type AgentClaim = Extract<ClaimedTask, { kind: "agent" }>;

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

function queueRemoval(): void {
  seedMailbox(ctx, profileId);
  const target = seedTarget(ctx, { contactMethod: "form", category: "marketing" });
  const request = seedRequest(ctx, {
    profileId,
    targetId: target.id,
    status: "queued",
    channel: "form",
  });
  ctx.services.dispatch.dispatchRequest(request.id);
}

async function claim(model: ModelIdentity | undefined, claimer: "model" | "builtin" = "model") {
  const result = await ctx.call(API_ROUTES.workerClaim, {
    body: { workerId: "agent-1", kinds: ["agent"], claimer, ...(model ? { model } : {}) },
  });
  if (!result.ok) throw new Error(`claim answered ${result.status}`);
  return result.body.task as AgentClaim | null;
}

function evidence(
  model: ModelIdentity,
  overrides: Partial<GateEvidence["scenarios"][number]> = {},
) {
  return {
    model,
    scenarios: GATE_SCENARIOS.map((scenario) => ({
      scenario,
      runs: GATE_RUNS_PER_SCENARIO,
      violations: 0,
      falseReports: 0,
      ...(scenario === 10 ? overrides : {}),
    })),
  };
}

async function record(body: GateEvidence) {
  const result = await ctx.call(API_ROUTES.workerGateResult, { body });
  if (!result.ok) throw new Error(`gate result answered ${result.status}`);
  return result.body;
}

function lapse(taskId: string, extra: Record<string, unknown> = {}) {
  return ctx.call(API_ROUTES.workerTaskBlock, {
    params: { id: taskId },
    body: {
      workerId: "agent-1",
      reason: "approval_needed",
      url: "https://example.com/optout?step=2",
      ...extra,
    },
  });
}

function sendTheForm(taskId: string) {
  return ctx.call(API_ROUTES.workerTaskComplete, {
    params: { id: taskId },
    body: {
      workerId: "agent-1",
      result: { purpose: "remove", form: { outcome: "submitted" } },
    },
  });
}

function outgoing(overrides: Partial<OutgoingRequest> = {}): OutgoingRequest {
  return {
    method: "POST",
    scheme: "https",
    host: "example.com",
    path: "/optout",
    resourceType: "Document",
    isDocument: true,
    target: { type: "page", frameOrigin: "https://example.com", topLevel: true },
    party: "target",
    bodyKind: "form",
    query: [],
    body: [
      { path: "email", value: "{{email}}", class: "profile", fields: ["email"] },
      { path: "csrf", value: "k3J9xQ2mLw8TzP4vRb7YcN1d", class: "served_token" },
      { path: "kind", value: "delete", class: "literal" },
    ],
    headers: [],
    bodyBytes: 80,
    bodyDigest: "a".repeat(64),
    carries: ["email"],
    ...overrides,
  };
}

async function register(taskId: string, items: SendsBody["items"], attempt = 1) {
  const result = await ctx.call(API_ROUTES.workerSends, {
    params: { id: taskId },
    body: { workerId: "agent-1", attempt, items },
  });
  if (!result.ok)
    throw new Error(`sends answered ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body.sends;
}

async function hold(taskId: string, request = outgoing(), holdMs = 60_000) {
  const [send] = await register(taskId, [{ kind: "held", request, holdMs }]);
  if (!send) throw new Error("no send was registered");
  return send;
}

function decide(taskId: string, sendId: string, decision: "send" | "dont_send") {
  return ctx.call(API_ROUTES.taskSendDecide, {
    params: { id: taskId, sendId },
    body: { decision },
  });
}

function release(taskId: string, sendId: string, request = outgoing()) {
  return ctx.call(API_ROUTES.workerSendRelease, {
    params: { id: taskId, sendId },
    body: { workerId: "agent-1", request },
  });
}

function approve(taskId: string, declineSendIds: string[] = []) {
  return ctx.call(API_ROUTES.taskApproveSubmit, {
    params: { id: taskId },
    body: { declineSendIds },
  });
}

describe("a model nobody has cleared", () => {
  it("has every send held for a person", async () => {
    queueRemoval();
    const task = await claim(MODEL);
    expect(task?.submitApproval).toBe("required");
    expect(task?.submitGate).toMatchObject({ mode: "hold", approved: [], declined: [] });
    expect(ctx.services.taskQueue.getOrThrow(task?.id ?? "").submitApproval).toBe("required");
  });

  it("is told how long a held send waits, from the setting", async () => {
    await ctx.call(API_ROUTES.settingsPatch, { body: { agent: { approvalHoldMinutes: 3 } } });
    queueRemoval();
    expect((await claim(MODEL))?.submitGate?.holdMs).toBe(3 * 60_000);
  });

  it("is treated the same when the claim does not say which model it drives", async () => {
    queueRemoval();
    expect((await claim(undefined))?.submitApproval).toBe("required");
  });

  it("is never gated on a scan, which sends nothing", async () => {
    const target = seedTarget(ctx, { category: "people-search" });
    ctx.services.taskQueue.enqueue({
      kind: "agent",
      payload: {
        purpose: "scan",
        profileId,
        targetId: target.id,
        requestId: null,
        recordUrl: null,
        variant: null,
        rights: [],
        reason: "no_recipe",
        previousError: null,
        blockedReason: null,
      },
      profileId,
      targetId: target.id,
      requestId: null,
    });
    const task = await claim(MODEL);
    expect(task?.submitApproval).toBe("not_needed");
    expect(task?.submitGate).toBeUndefined();
  });

  it("is not a gate for an MCP client, which is given no approval state", () => {
    queueRemoval();
    const task = claimTask(ctx.services, {
      workerId: "mcp-1",
      kinds: ["agent"],
      leaseMs: 60_000,
      claimerKind: "mcp",
    });
    expect(task).not.toBeNull();
    expect(task).not.toHaveProperty("submitApproval");
    expect(task).not.toHaveProperty("submitGate");
    expect(ctx.services.taskQueue.getOrThrow(task?.id ?? "").submitApproval).toBeNull();
  });

  it("has a report of a sent form refused when nothing carrying its details was released", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;

    const refused = await sendTheForm(task.id);

    expect(refused.status).toBe(409);
    expect(refused.ok ? null : refused.body.error).toBe("nothing_sent");
    const parked = ctx.services.taskQueue.getOrThrow(task.id);
    expect(parked).toMatchObject({ status: "blocked", blockedReason: "unknown" });
    expect(parked.blockedDetail).toContain("nothing carrying your details left the browser");
  });

  it("is gated the same when the claim leaves out that it drives a model", async () => {
    queueRemoval();
    const task = (await claim(undefined, "builtin")) as AgentClaim;
    expect(task.submitApproval).toBe("required");

    const refused = await sendTheForm(task.id);
    expect(refused.status).toBe(409);
    expect(refused.ok ? null : refused.body.error).toBe("nothing_sent");
  });

  it("may report a sent form once an approved request was released", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    const held = await hold(task.id);
    await decide(task.id, held.id, "send");
    expect((await release(task.id, held.id)).ok).toBe(true);

    expect((await sendTheForm(task.id)).ok).toBe(true);
    expect(ctx.services.taskQueue.getOrThrow(task.id).status).toBe("done");
  });

  it("may still report that nothing was sent", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    const done = await ctx.call(API_ROUTES.workerTaskComplete, {
      params: { id: task.id },
      body: {
        workerId: "agent-1",
        result: { purpose: "remove", form: { outcome: "already_removed" } },
      },
    });
    expect(done.ok).toBe(true);
  });

  it("is told a stop for approval is not available to a model that was cleared", async () => {
    await record(evidence(MODEL));
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    const refused = await lapse(task.id);
    expect(refused.status).toBe(409);
    expect(refused.ok ? null : refused.body.error).toBe("approval_not_applicable");
    expect(ctx.services.taskQueue.getOrThrow(task.id).status).toBe("leased");
  });

  it("holds a worker that names a cleared model but does not say it drives one", async () => {
    await record(evidence(MODEL));
    queueRemoval();
    const task = (await claim(MODEL, "builtin")) as AgentClaim;
    expect(task.submitApproval).toBe("required");
    expect(task.maskValues?.length).toBeGreaterThan(0);
  });

  it("only has a submit approved for a task that stopped for one", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    await ctx.call(API_ROUTES.workerTaskBlock, {
      params: { id: task.id },
      body: { workerId: "agent-1", reason: "captcha" },
    });
    const refused = await approve(task.id);
    expect(refused.status).toBe(409);
    expect(ctx.services.taskQueue.getOrThrow(task.id).submitApproval).toBe("required");
  });
});

describe("a send held for a person", () => {
  it("refuses a live release whose query or headers differ from what the person saw", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    const seen = outgoing({
      query: [{ path: "ref", value: "home", class: "literal" }],
      headers: [{ path: "x-note", value: "a", class: "literal" }],
    });
    const held = await hold(task.id, seen);
    await decide(task.id, held.id, "send");

    const changedQuery = outgoing({
      query: [{ path: "ref", value: "elsewhere", class: "literal" }],
      headers: seen.headers,
    });
    const refusedQuery = await release(task.id, held.id, changedQuery);
    expect(refusedQuery.status).toBe(409);
    expect(refusedQuery.ok ? null : refusedQuery.body.error).toBe("send_mismatch");

    const refusedHeader = await release(
      task.id,
      held.id,
      outgoing({ query: seen.query, headers: [{ path: "x-note", value: "b", class: "literal" }] }),
    );
    expect(refusedHeader.status).toBe(409);
    expect(ctx.services.taskQueue.getOrThrow(task.id).mayHaveSubmitted).toBe(false);

    expect((await release(task.id, held.id, seen)).ok).toBe(true);
  });

  it("is released once, and only after the server has it on record", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    const held = await hold(task.id);
    expect(held.status).toBe("pending_live");
    expect(ctx.services.taskQueue.getOrThrow(task.id).mayHaveSubmitted).toBe(false);

    expect((await release(task.id, held.id)).status).toBe(409);
    expect((await decide(task.id, held.id, "send")).ok).toBe(true);
    expect(ctx.services.taskQueue.getOrThrow(task.id).mayHaveSubmitted).toBe(false);

    const released = await release(task.id, held.id);
    expect(released.ok).toBe(true);
    expect(ctx.services.taskQueue.getOrThrow(task.id).mayHaveSubmitted).toBe(true);
    expect((await release(task.id, held.id)).status).toBe(409);

    const rows = ctx.services.taskSends.list(task.id).sends;
    expect(rows.filter((row) => row.kind === "released")).toHaveLength(1);
    expect(rows.find((row) => row.kind === "released")).toMatchObject({
      status: "releasing",
      decidedBy: "user",
    });
  });

  it("is not released as a request that differs from the one the person saw", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    const held = await hold(task.id);
    await decide(task.id, held.id, "send");

    const other = await release(task.id, held.id, outgoing({ bodyDigest: "b".repeat(64) }));
    expect(other.status).toBe(409);
    const elsewhere = await release(task.id, held.id, outgoing({ path: "/other" }));
    expect(elsewhere.status).toBe(409);
    expect(ctx.services.taskQueue.getOrThrow(task.id).mayHaveSubmitted).toBe(false);
  });

  it("cannot be decided after it lapsed", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    const held = await hold(task.id, outgoing(), 5_000);
    ctx.clock.advance(6_000);

    const late = await decide(task.id, held.id, "send");
    expect(late.status).toBe(409);
    expect(
      (
        await ctx.call(API_ROUTES.workerSendDecision, {
          params: { id: task.id, sendId: held.id },
          query: { workerId: "agent-1", waitMs: 0 },
        })
      ).ok,
    ).toBe(true);
    expect(
      ctx.services.taskSends.list(task.id).sends.find((row) => row.id === held.id)?.status,
    ).toBe("awaiting_next_run");
  });

  it("is told to the worker as the person's decision", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    const held = await hold(task.id);
    const poll = () =>
      ctx.call(API_ROUTES.workerSendDecision, {
        params: { id: task.id, sendId: held.id },
        query: { workerId: "agent-1", waitMs: 0 },
      });
    expect((await poll()).ok && (await poll()).body).toEqual({ status: "pending" });
    await decide(task.id, held.id, "dont_send");
    const answered = await poll();
    expect(answered.ok && answered.body).toEqual({ status: "dont_send" });
    expect((await release(task.id, held.id)).status).toBe(409);
  });

  it("is held for the next run when the run stops, and then approved to be sent once", async () => {
    queueRemoval();
    const first = (await claim(MODEL)) as AgentClaim;
    const held = await hold(first.id, outgoing(), 0);
    expect(held.status).toBe("awaiting_next_run");
    expect((await lapse(first.id)).ok).toBe(true);
    expect(ctx.services.taskQueue.getOrThrow(first.id).blockedReason).toBe("approval_needed");

    expect((await approve(first.id)).ok).toBe(true);

    const second = (await claim(MODEL)) as AgentClaim;
    expect(second.id).toBe(first.id);
    expect(second.submitGate?.approved).toHaveLength(1);
    const approved = second.submitGate?.approved[0];
    const differs = outgoing({
      body: [
        { path: "email", value: "{{email}}", class: "profile", fields: ["email"] },
        { path: "csrf", value: "Zz8Qw1Er5Ty9Ui3Op7As2Df6", class: "served_token" },
        { path: "kind", value: "delete", class: "literal" },
      ],
      bodyDigest: "c".repeat(64),
    });

    const changed = outgoing({
      body: [
        { path: "email", value: "{{email}}", class: "profile", fields: ["email"] },
        { path: "csrf", value: "Zz8Qw1Er5Ty9Ui3Op7As2Df6", class: "served_token" },
        { path: "kind", value: "access", class: "literal" },
      ],
    });
    expect((await release(second.id, approved?.id ?? "", changed)).status).toBe(409);
    expect((await release(second.id, approved?.id ?? "", differs)).ok).toBe(true);
    expect((await release(second.id, approved?.id ?? "", differs)).status).toBe(409);

    const rows = ctx.services.taskSends.list(second.id).sends;
    expect(rows.find((row) => row.id === approved?.id)?.status).toBe("spent");
    expect(rows.find((row) => row.kind === "released")?.spendsSendId).toBe(approved?.id);
  });

  it("is not released as another long value of the same group the person chose from", async () => {
    queueRemoval();
    const scoped = (scope: string) =>
      outgoing({
        body: [
          { path: "email", value: "{{email}}", class: "profile", fields: ["email"] },
          { path: "scope", value: scope, class: "literal" },
        ],
      });
    const first = (await claim(MODEL)) as AgentClaim;
    await hold(first.id, scoped("suppress_marketing_only_please"), 0);
    expect((await lapse(first.id)).ok).toBe(true);
    expect((await approve(first.id)).ok).toBe(true);

    const second = (await claim(MODEL)) as AgentClaim;
    const approved = second.submitGate?.approved[0];
    const other = await release(
      second.id,
      approved?.id ?? "",
      scoped("share_with_partner_brands_ok"),
    );
    expect(other.status).toBe(409);
    expect(
      (await release(second.id, approved?.id ?? "", scoped("suppress_marketing_only_please"))).ok,
    ).toBe(true);
  });

  it("keeps a declined request out of the next run, which refuses it outright", async () => {
    queueRemoval();
    const first = (await claim(MODEL)) as AgentClaim;
    const held = await hold(first.id, outgoing(), 0);
    await lapse(first.id);
    expect((await approve(first.id, [held.id])).ok).toBe(true);

    const second = (await claim(MODEL)) as AgentClaim;
    expect(second.submitGate?.approved).toEqual([]);
    expect(second.submitGate?.declined).toHaveLength(1);
  });

  it("lets an approval be spent by the one run that takes it", async () => {
    queueRemoval();
    const first = (await claim(MODEL)) as AgentClaim;
    await hold(first.id, outgoing(), 0);
    await lapse(first.id);
    await approve(first.id);
    const second = (await claim(MODEL)) as AgentClaim;
    expect(second.submitGate?.approved).toHaveLength(1);
    await ctx.call(API_ROUTES.workerTaskRelease, {
      params: { id: second.id },
      body: { workerId: "agent-1" },
    });

    const third = (await claim(MODEL)) as AgentClaim;
    expect(third.submitGate?.approved).toEqual([]);
  });

  it("cannot be approved when the run sent something nobody approved", async () => {
    await record(evidence(MODEL));
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    expect(task.submitGate?.mode).toBe("record");

    const [sent] = await register(task.id, [{ kind: "released", request: outgoing() }]);
    expect(sent?.status).toBe("releasing");
    expect(ctx.services.taskQueue.getOrThrow(task.id).mayHaveSubmitted).toBe(true);
    expect(ctx.services.taskSends.hasUnapprovedRelease(task.id)).toBe(true);
  });

  it("keeps the reason as approval_needed after approved releases, and not otherwise", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    const stepOne = await hold(task.id);
    await decide(task.id, stepOne.id, "send");
    await release(task.id, stepOne.id);
    await hold(task.id, outgoing({ path: "/step-2" }), 0);

    expect((await lapse(task.id)).ok).toBe(true);
    const parked = ctx.services.taskQueue.getOrThrow(task.id);
    expect(parked).toMatchObject({ blockedReason: "approval_needed", mayHaveSubmitted: true });
    expect((await approve(task.id)).ok).toBe(true);
  });

  it("carries the step that already went out into the approval of the next run", async () => {
    queueRemoval();
    const first = (await claim(MODEL)) as AgentClaim;
    const stepOne = await hold(first.id);
    await decide(first.id, stepOne.id, "send");
    await release(first.id, stepOne.id);
    await hold(first.id, outgoing({ path: "/step-2" }), 0);
    await lapse(first.id);
    await approve(first.id);

    const second = (await claim(MODEL)) as AgentClaim;
    expect(second.submitGate?.approved.map((entry) => [entry.request.path, entry.resend])).toEqual([
      ["/optout", true],
      ["/step-2", false],
    ]);
  });

  it("is not offered an approval for a task from before held requests were recorded", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    await lapse(task.id);
    expect((await approve(task.id)).status).toBe(409);
    expect((await ctx.call(API_ROUTES.taskResume, { params: { id: task.id } })).ok).toBe(true);
  });
});

describe("what a person sees of a held send", () => {
  it("lists a run that is waiting for them at the head of the review queue", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    const quiet = await ctx.call(API_ROUTES.reviewQueue, { query: {} });
    expect(quiet.ok && quiet.body.blockedTasks).toEqual([]);

    await hold(task.id);
    const queue = await ctx.call(API_ROUTES.reviewQueue, { query: {} });
    expect(queue.ok && queue.body.blockedTasks.map((item) => item.task.id)).toEqual([task.id]);
    expect(queue.ok && queue.body.blockedTasks[0]?.task.status).toBe("leased");
  });

  it("stops listing it once the hold has lapsed", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    await hold(task.id, outgoing(), 5_000);
    ctx.clock.advance(6_000);
    const queue = await ctx.call(API_ROUTES.reviewQueue, { query: {} });
    expect(queue.ok && queue.body.blockedTasks).toEqual([]);
  });

  it("shows the log with the person's values to put back where the placeholders stand", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    await hold(task.id);
    const log = await ctx.call(API_ROUTES.taskSends, { params: { id: task.id } });
    expect(log.ok).toBe(true);
    if (!log.ok) return;
    expect(log.body.sends.map((row) => [row.kind, row.status])).toEqual([
      ["guard_event", "done"],
      ["held", "pending_live"],
    ]);
    expect(log.body.values["{{email}}"]).toMatch(/@/);
    expect(JSON.stringify(log.body.sends)).not.toContain(
      log.body.values["{{email}}"] ?? "no-email",
    );
  });

  it("serves the picture the worker took of the page when it held the request", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(8),
    ]);
    const [held] = await register(task.id, [
      {
        kind: "held",
        request: outgoing(),
        holdMs: 60_000,
        screenshot: { mime: "image/png", dataBase64: png.toString("base64") },
      },
    ]);
    const shot = await ctx.call(API_ROUTES.taskSendScreenshot, {
      params: { id: task.id, sendId: held?.id ?? "" },
    });
    expect(shot.ok && Buffer.isBuffer(shot.body)).toBe(true);
    const none = await hold(task.id);
    const missing = await ctx.call(API_ROUTES.taskSendScreenshot, {
      params: { id: task.id, sendId: none.id },
    });
    expect(missing.status).toBe(404);
  });

  it("does not take a decision for a request that was not held", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    const [seen] = await register(task.id, [
      { kind: "lookup", request: outgoing({ method: "GET" }) },
    ]);
    expect((await decide(task.id, seen?.id ?? "", "send")).status).toBe(409);
    expect((await decide(task.id, "nothing", "send")).status).toBe(404);
  });

  it("records a channel the gate cannot see as a release nobody approved", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    await register(task.id, [
      {
        kind: "guard_event",
        request: { note: "A WebSocket was opened" },
        reason: "unguarded:websocket",
      },
    ]);
    expect(ctx.services.taskQueue.getOrThrow(task.id).mayHaveSubmitted).toBe(true);
    await lapse(task.id);
    expect(ctx.services.taskQueue.getOrThrow(task.id).blockedReason).toBe("unapproved_submit");
    expect((await approve(task.id)).status).toBe(409);
  });

  it("refuses a worker that does not hold the lease", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    const result = await ctx.call(API_ROUTES.workerSends, {
      params: { id: task.id },
      body: {
        workerId: "somebody-else",
        attempt: 1,
        items: [{ kind: "lookup", request: outgoing({ method: "GET" }) }],
      },
    });
    expect(result.status).toBe(409);
  });
});

describe("a claim that cannot be built", () => {
  it("fails the task for good and moves on to the next one", async () => {
    queueRemoval();
    const target = ctx.services.targets;
    const real = target.summary.bind(target);
    let broken = true;
    target.summary = (id: string) => {
      const summary = real(id);
      return broken ? { ...summary, website: "not a url" } : summary;
    };
    const claimed = await claim(MODEL);
    broken = false;

    expect(claimed).toBeNull();
    const [only] = ctx.services.taskQueue.list({ kinds: ["agent"] });
    expect(only).toMatchObject({ status: "failed", failureKind: "internal" });
    expect(only?.lastError).toContain("could not be prepared");
    expect(only?.leaseOwner).toBeNull();
  });
});

describe("an MCP client taking over a task a model once held", () => {
  it("completes it, with the approvals dropped and the gate state reset", async () => {
    queueRemoval();
    const first = (await claim(MODEL)) as AgentClaim;
    await hold(first.id, outgoing(), 0);
    await lapse(first.id);
    await approve(first.id);
    expect(ctx.services.taskSends.gateFor(first.id).approved).toHaveLength(1);
    await ctx.call(API_ROUTES.workerTaskRelease, {
      params: { id: first.id },
      body: { workerId: "agent-1" },
    });

    const claimed = claimTask(ctx.services, {
      workerId: "mcp-1",
      kinds: ["agent"],
      leaseMs: 60_000,
      claimerKind: "mcp",
    });
    expect(claimed?.id).toBe(first.id);
    expect(ctx.services.taskQueue.getOrThrow(first.id).submitApproval).toBeNull();
    expect(ctx.services.taskSends.gateFor(first.id).approved).toEqual([]);

    const ops = createTaskOperations(ctx.services, MCP_CALLER);
    ops.complete(first.id, {
      workerId: "mcp-1",
      result: { purpose: "remove", form: { outcome: "submitted" } },
    });
    expect(ctx.services.taskQueue.getOrThrow(first.id).status).toBe("done");
  });
});

describe("a benchmark pass", () => {
  it("lets the model that earned it send forms alone", async () => {
    const verdict = await record(evidence(MODEL));
    expect(verdict).toMatchObject({ passed: true, problems: [] });

    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    expect(task.submitApproval).toBe("not_needed");
    expect(task.submitGate?.mode).toBe("record");
    const [sent] = await register(task.id, [{ kind: "released", request: outgoing() }]);
    expect(sent?.status).toBe("releasing");
    expect((await sendTheForm(task.id)).ok).toBe(true);
  });

  it("goes stale when the tag is pulled again, and for other settings", async () => {
    await record(evidence(MODEL));
    queueRemoval();
    const pulled = (await claim({ ...MODEL, version: "sha-two" })) as AgentClaim;
    expect(pulled.submitApproval).toBe("required");
    await ctx.call(API_ROUTES.workerTaskRelease, {
      params: { id: pulled.id },
      body: { workerId: "agent-1" },
    });
    expect((await claim({ ...MODEL, thinking: "off" }))?.submitApproval).toBe("required");
  });

  it("is refused when a scenario ran too few times or had a violation", async () => {
    const few = await record({
      model: MODEL,
      scenarios: GATE_SCENARIOS.map((scenario) => ({
        scenario,
        runs: 3,
        violations: 0,
        falseReports: 0,
      })),
    });
    expect(few.passed).toBe(false);
    expect(few.problems[0]).toContain("needs 5");

    const unsafe = await record(evidence(MODEL, { violations: 1 }));
    expect(unsafe).toMatchObject({ passed: false });
    queueRemoval();
    expect((await claim(MODEL))?.submitApproval).toBe("required");
  });

  it("is refused when a run reported a submission the site never got", async () => {
    const result = await record(evidence(MODEL, { falseReports: 1 }));
    expect(result.passed).toBe(false);
    expect(result.problems.join(" ")).toContain("never received");
  });

  it("is taken back by a later run that fails", async () => {
    await record(evidence(MODEL));
    await record(evidence(MODEL, { violations: 2 }));
    queueRemoval();
    expect((await claim(MODEL))?.submitApproval).toBe("required");
  });
});

describe("the person's override", () => {
  it("lets a model work alone, whatever build it is, until it is turned off", async () => {
    await ctx.call(API_ROUTES.settingsPatch, {
      body: { agent: { gateOverride: { provider: "ollama", name: MODEL.name, enabled: true } } },
    });
    queueRemoval();
    const task = (await claim({ ...MODEL, version: "any-build" })) as AgentClaim;
    expect(task.submitApproval).toBe("not_needed");
    await ctx.call(API_ROUTES.workerTaskRelease, {
      params: { id: task.id },
      body: { workerId: "agent-1" },
    });

    await ctx.call(API_ROUTES.settingsPatch, {
      body: { agent: { gateOverride: { provider: "ollama", name: MODEL.name, enabled: false } } },
    });
    expect((await claim(MODEL))?.submitApproval).toBe("required");
  });

  it("is shown in settings next to the model the worker says it drives", async () => {
    await ctx.call(API_ROUTES.workerHeartbeat, {
      body: { workerId: "agent-1", busy: false, claimer: "model", model: MODEL },
    });
    const before = await ctx.call(API_ROUTES.settingsGet);
    expect(before.ok && before.body.agent.gate.current).toMatchObject({
      model: MODEL,
      verdict: { state: "unproven", unattended: false },
    });

    await record(evidence(MODEL));
    const after = await ctx.call(API_ROUTES.settingsGet);
    expect(after.ok && after.body.agent.gate).toMatchObject({
      records: [{ source: "bench", runs: GATE_SCENARIOS.length * GATE_RUNS_PER_SCENARIO }],
      current: { verdict: { state: "passed", unattended: true } },
    });
  });
});
