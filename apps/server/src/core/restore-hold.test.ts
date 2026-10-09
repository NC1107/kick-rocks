import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  MINUTE,
  seedMailbox,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { claimTask } from "./claim.js";
import { RESTORE_MARKER } from "./restore-gate.js";
import { MAY_HAVE_BEEN_SUBMITTED } from "./restore-settle.js";

let ctx: TestContext;
let profileId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  seedMailbox(ctx, profileId);
});

afterEach(async () => {
  await ctx.close();
});

const claim = (kinds: Parameters<typeof claimTask>[1]["kinds"], taskId?: string) =>
  claimTask(ctx.services, {
    workerId: "worker-1",
    kinds,
    leaseMs: 300_000,
    claimerKind: "builtin",
    taskId,
  });

function queuedForm(domain = "spokeo.test") {
  const target = seedTarget(ctx, { contactMethod: "form", domain, name: domain });
  seedRecipe(ctx, target.id, { purpose: "remove" });
  const request = seedRequest(ctx, {
    profileId,
    targetId: target.id,
    status: "queued",
    channel: "form",
    recordUrl: `https://${domain}/p/1`,
  });
  const { task } = ctx.services.dispatch.dispatchRequest(request.id);
  return { request, task, target };
}

function queuedAgentScan() {
  const target = seedTarget(ctx, { domain: "scan.test", name: "scan.test" });
  return ctx.services.taskQueue.enqueue({
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
  }).task;
}

const markRestored = () =>
  writeFileSync(
    join(ctx.services.config.dataDir, RESTORE_MARKER),
    `${ctx.clock.now().toISOString()}\n`,
  );

describe("browser work while sending is held after a restore", () => {
  it("does not let a worker claim a form that was queued when the backup was taken", () => {
    const { task } = queuedForm();
    ctx.clock.advance(MINUTE);
    markRestored();

    expect(claim(["form"])).toBeNull();
    expect(claim(["scan", "form", "confirm", "agent", "canary"])).toBeNull();
    expect(ctx.services.taskQueue.getOrThrow(task.id).status).toBe("queued");
  });

  it("refuses to claim a held form by its id", () => {
    const { task } = queuedForm();
    markRestored();

    expect(() => claim(["form"], task.id)).toThrow(
      expect.objectContaining({ code: "restore_hold" }),
    );
  });

  it("still lets an agent read a site, because a scan sends nothing", () => {
    const form = queuedForm();
    const scan = queuedAgentScan();
    markRestored();

    expect(claim(["form", "agent"])?.id).toBe(scan.id);
    expect(ctx.services.taskQueue.getOrThrow(form.task.id).status).toBe("queued");
  });

  it("holds an agent that removes", () => {
    const target = seedTarget(ctx, { domain: "agent.test", name: "agent.test" });
    const request = seedRequest(ctx, {
      profileId,
      targetId: target.id,
      status: "queued",
      channel: "form",
    });
    ctx.services.taskQueue.enqueue({
      kind: "agent",
      payload: {
        purpose: "remove",
        profileId,
        targetId: target.id,
        requestId: request.id,
        recordUrl: null,
        variant: null,
        rights: [],
        reason: "no_recipe",
        previousError: null,
        blockedReason: null,
      },
      profileId,
      targetId: target.id,
      requestId: request.id,
    });
    markRestored();

    expect(claim(["agent"])).toBeNull();
  });

  it("claims again once the hold lifts, for work queued after the restore", () => {
    markRestored();
    ctx.clock.advance(MINUTE);
    const { task } = queuedForm();
    ctx.services.restoreGate.release("confirmed");

    expect(claim(["form"])?.id).toBe(task.id);
  });

  it("moves the forms that were queued at the restore to Review when the hold lifts", () => {
    const old = queuedForm("old.test");
    ctx.clock.advance(MINUTE);
    markRestored();
    ctx.clock.advance(MINUTE);
    const fresh = queuedForm("fresh.test");

    ctx.services.restoreGate.release("confirmed");

    expect(ctx.services.taskQueue.getOrThrow(old.task.id)).toMatchObject({
      status: "blocked",
      blockedDetail: MAY_HAVE_BEEN_SUBMITTED,
    });
    expect(ctx.services.taskQueue.getOrThrow(fresh.task.id).status).toBe("queued");
    expect(claim(["form"])?.id).toBe(fresh.task.id);
  });

  it("records a form the send journal shows went out, and does not ask a person about it", () => {
    const sent = queuedForm("sent.test");
    const unknown = queuedForm("unknown.test");
    ctx.clock.advance(MINUTE);
    ctx.services.sentJournal.append({
      requestId: sent.request.id,
      ref: sent.task.id,
      channel: "form",
    });
    ctx.clock.advance(MINUTE);
    markRestored();

    ctx.services.restoreGate.release("confirmed");

    expect(ctx.services.taskQueue.getOrThrow(sent.task.id).status).toBe("cancelled");
    expect(ctx.services.requests.getOrThrow(sent.request.id).status).toBe("awaiting_reply");
    expect(
      ctx.services.requests.events(sent.request.id).find((event) => event.type === "sent"),
    ).toMatchObject({ payload: { channel: "form", foundInJournal: true } });
    expect(ctx.services.taskQueue.getOrThrow(unknown.task.id).status).toBe("blocked");
  });

  it("lets a person resume a held form from Review", () => {
    const { task } = queuedForm();
    ctx.clock.advance(MINUTE);
    markRestored();
    ctx.services.restoreGate.release("confirmed");

    ctx.services.taskQueue.resume(task.id);

    expect(claim(["form"])?.id).toBe(task.id);
  });
});
