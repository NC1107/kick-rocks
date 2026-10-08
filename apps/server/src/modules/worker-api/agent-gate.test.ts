import {
  API_ROUTES,
  type ClaimedTask,
  GATE_RUNS_PER_SCENARIO,
  GATE_SCENARIOS,
  type GateEvidence,
  type ModelIdentity,
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

function sendTheForm(taskId: string) {
  return ctx.call(API_ROUTES.workerTaskComplete, {
    params: { id: taskId },
    body: {
      workerId: "agent-1",
      result: { purpose: "remove", form: { outcome: "submitted" } },
    },
  });
}

describe("a model nobody has cleared", () => {
  it("must be approved for each submit of a removal", async () => {
    queueRemoval();
    const task = await claim(MODEL);
    expect(task?.submitApproval).toBe("required");
    expect(ctx.services.taskQueue.getOrThrow(task?.id ?? "").submitApproval).toBe("required");
  });

  it("is treated the same when the claim does not say which model it drives", async () => {
    queueRemoval();
    expect((await claim(undefined))?.submitApproval).toBe("required");
  });

  it("is never asked to approve a scan, which sends nothing", async () => {
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
    expect((await claim(MODEL))?.submitApproval).toBe("not_needed");
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
    expect(ctx.services.taskQueue.getOrThrow(task?.id ?? "").submitApproval).toBeNull();
  });

  it("has a report of a sent form refused, and the task parked for a person", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;

    const refused = await sendTheForm(task.id);

    expect(refused.status).toBe(409);
    expect(refused.ok ? null : refused.body.error).toBe("approval_required");
    expect(ctx.services.taskQueue.getOrThrow(task.id)).toMatchObject({
      status: "blocked",
      blockedReason: "unapproved_submit",
    });
  });

  it("is gated the same when the claim leaves out that it drives a model", async () => {
    queueRemoval();
    const task = (await claim(undefined, "builtin")) as AgentClaim;
    expect(task.submitApproval).toBe("required");

    const refused = await sendTheForm(task.id);
    expect(refused.status).toBe(409);
    expect(refused.ok ? null : refused.body.error).toBe("approval_required");
  });

  it("cannot have the submit approved once a sent form was refused", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    await ctx.call(API_ROUTES.workerTaskHeartbeat, {
      params: { id: task.id },
      body: { workerId: "agent-1", mayHaveSubmitted: true },
    });
    expect((await sendTheForm(task.id)).status).toBe(409);

    const approved = await ctx.call(API_ROUTES.taskApproveSubmit, { params: { id: task.id } });
    expect(approved.status).toBe(409);
    expect(ctx.services.taskQueue.getOrThrow(task.id)).toMatchObject({
      status: "blocked",
      mayHaveSubmitted: true,
    });
  });

  it("is not offered an approval when the model may already have clicked", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    await ctx.call(API_ROUTES.workerTaskHeartbeat, {
      params: { id: task.id },
      body: { workerId: "agent-1", mayHaveSubmitted: true },
    });
    await ctx.call(API_ROUTES.workerTaskBlock, {
      params: { id: task.id },
      body: { workerId: "agent-1", reason: "approval_needed" },
    });

    expect(ctx.services.taskQueue.getOrThrow(task.id).blockedReason).toBe("unapproved_submit");
    const approved = await ctx.call(API_ROUTES.taskApproveSubmit, { params: { id: task.id } });
    expect(approved.status).toBe(409);
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

  it("runs the submit once a person approves it, and asks again for the next attempt", async () => {
    queueRemoval();
    const first = (await claim(MODEL)) as AgentClaim;
    await ctx.call(API_ROUTES.workerTaskBlock, {
      params: { id: first.id },
      body: { workerId: "agent-1", reason: "approval_needed", detail: "Stopped before Submit." },
    });

    const approved = await ctx.call(API_ROUTES.taskApproveSubmit, { params: { id: first.id } });
    expect(approved.ok && approved.body.task.status).toBe("queued");

    const second = await claim(MODEL);
    expect(second?.id).toBe(first.id);
    expect(second?.submitApproval).toBe("granted");
    expect((await sendTheForm(first.id)).ok).toBe(true);
  });

  it("holds the approved run to the control the person looked at", async () => {
    queueRemoval();
    const first = (await claim(MODEL)) as AgentClaim;
    await ctx.call(API_ROUTES.workerTaskBlock, {
      params: { id: first.id },
      body: {
        workerId: "agent-1",
        reason: "approval_needed",
        url: "https://example.com/optout?step=2",
        control: "Submit request",
      },
    });
    await ctx.call(API_ROUTES.taskApproveSubmit, { params: { id: first.id } });

    const second = await claim(MODEL);
    expect(second?.approvedSubmit).toEqual({
      origin: "https://example.com",
      control: "Submit request",
    });
  });

  it("does not reuse an approval for a later attempt", async () => {
    queueRemoval();
    const first = (await claim(MODEL)) as AgentClaim;
    await ctx.call(API_ROUTES.workerTaskBlock, {
      params: { id: first.id },
      body: { workerId: "agent-1", reason: "approval_needed" },
    });
    await ctx.call(API_ROUTES.taskApproveSubmit, { params: { id: first.id } });
    expect((await claim(MODEL))?.submitApproval).toBe("granted");
    await ctx.call(API_ROUTES.workerTaskRelease, {
      params: { id: first.id },
      body: { workerId: "agent-1" },
    });

    expect((await claim(MODEL))?.submitApproval).toBe("required");
  });

  it("only has a submit approved for a task that stopped for one", async () => {
    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    await ctx.call(API_ROUTES.workerTaskBlock, {
      params: { id: task.id },
      body: { workerId: "agent-1", reason: "captcha" },
    });
    const refused = await ctx.call(API_ROUTES.taskApproveSubmit, { params: { id: task.id } });
    expect(refused.status).toBe(409);
    expect(ctx.services.taskQueue.getOrThrow(task.id).submitApproval).toBe("required");
  });
});

describe("a benchmark pass", () => {
  it("lets the model that earned it send forms alone", async () => {
    const verdict = await record(evidence(MODEL));
    expect(verdict).toMatchObject({ passed: true, problems: [] });

    queueRemoval();
    const task = (await claim(MODEL)) as AgentClaim;
    expect(task.submitApproval).toBe("not_needed");
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
