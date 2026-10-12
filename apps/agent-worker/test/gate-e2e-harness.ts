import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_ROUTES, type SendRow } from "@kickrocks/shared";
import { BROWSER_CONTEXT_OPTIONS } from "@kickrocks/worker/dist/browser.js";
import { createLogger } from "@kickrocks/worker/dist/logger.js";
import type { Browser, BrowserContext } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import {
  createTestContext,
  seedMailbox,
  seedProfile,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../../server/src/test-utils/index.js";
import type { AgentWorkerConfig } from "../src/config.js";
import { runAgentWorker } from "../src/worker.js";
import { ORIGIN } from "./fixtures/server.js";
import { launchTestBrowser, resetFixture, type Step, scripted, type Turn } from "./support.js";

vi.setConfig({ testTimeout: 120_000 });

const debugLogger = createLogger(process.env.GATE_LOG === "1" ? "debug" : "error");
/** Long enough that a person (the test) can answer, short enough that a lapse is quick. */
export const ANSWER_MS = 30_000;
const LAPSE_MS = 1_200;

/** Set once the server listens, on a port the operating system picked so no run needs one free. */
let serverUrl = "";
/** The browser context of the run in progress, for a test that has to look at its tabs. */
export let runContext: BrowserContext | null = null;
export let browser: Browser;
export let ctx: TestContext;
let profileDir: string;

beforeAll(async () => {
  browser = await launchTestBrowser();
});
afterAll(async () => {
  await browser.close();
});
beforeEach(async () => {
  profileDir = mkdtempSync(join(tmpdir(), "kickrocks-gate-"));
  await resetFixture();
});
afterEach(async () => {
  await ctx?.app.close().catch(() => undefined);
  await ctx?.close().catch(() => undefined);
  rmSync(profileDir, { recursive: true, force: true });
});

function config(): AgentWorkerConfig {
  return {
    serverUrl,
    token: ctx.workerToken,
    workerId: "gate-agent",
    pollMs: 20,
    leaseMs: 60_000,
    provider: {
      kind: "openai",
      model: "uncleared-model",
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: null,
      maxOutputTokens: 1024,
      tokenParam: "max_tokens",
      numCtx: 16_384,
      thinking: "default",
    },
    pricing: null,
    limits: { maxSteps: 30, maxMs: 60_000, maxTotalTokens: null },
    chromeProfileDir: profileDir,
    headless: true,
    noSandbox: false,
    allowHttp: true,
    pace: "instant",
    chromeExecutable: null,
    logLevel: "error",
  } as AgentWorkerConfig;
}

/** Queues one removal whose opt-out page is `path` on the fixture site. */
export async function startServer(path = "/gate-form", twoHosts = false): Promise<string> {
  ctx = await createTestContext();
  const profileId = seedProfile(ctx).id;
  seedMailbox(ctx, profileId);
  const target = seedTarget(ctx, {
    contactMethod: "form",
    category: "marketing",
    domain: "127.0.0.1",
    optOutUrl: `${ORIGIN}${path}`,
    website: twoHosts ? `http://localhost:${new URL(ORIGIN).port}/` : `${ORIGIN}/`,
  });
  const request = seedRequest(ctx, {
    profileId,
    targetId: target.id,
    status: "queued",
    channel: "form",
  });
  ctx.services.dispatch.dispatchRequest(request.id);
  serverUrl = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  const task = ctx.services.taskQueue
    .list({ kinds: ["agent"], status: "queued" })
    .find((t) => t.kind === "agent");
  if (!task) throw new Error("no agent task was queued");
  return task.id;
}

interface WorkOptions {
  /** How long a held send waits for the person before the run gives up on it. */
  holdMs?: number;
  maxScreenshotBytes?: number;
}

/** Runs the real agent worker against the real server until the task leaves the lease. */
export async function workOnce(taskId: string, steps: Step[], options: WorkOptions = {}) {
  const controller = new AbortController();
  const claimed = vi.fn();
  const finished = runAgentWorker({
    config: config(),
    signal: controller.signal,
    logger: debugLogger,
    provider: scripted(steps),
    launcher: async () => {
      runContext = await browser.newContext(BROWSER_CONTEXT_OPTIONS);
      return runContext;
    },
    timing: {
      idleHeartbeatMs: 10_000,
      leaseHeartbeatMs: 1_000,
      reportRetryMs: 1,
      shutdownGraceMs: 300,
    },
    challengeGraceMs: 200,
    holdMsCap: options.holdMs ?? LAPSE_MS,
    ...(options.maxScreenshotBytes === undefined
      ? {}
      : { maxScreenshotBytes: options.maxScreenshotBytes }),
  });
  try {
    await vi.waitUntil(
      () => {
        const status = ctx.services.taskQueue.getOrThrow(taskId).status;
        if (status === "leased") claimed();
        return claimed.mock.calls.length > 0 && status !== "leased";
      },
      { timeout: 90_000, interval: 25 },
    );
  } finally {
    controller.abort();
    await finished;
  }
  return ctx.services.taskQueue.getOrThrow(taskId);
}

type Answer = "send" | "dont_send" | "nobody";

/**
 * Answers the requests a run holds, one answer for each, through the same route the review page
 * uses. `nobody` leaves a request alone so that it lapses.
 */
export async function answerHolds(taskId: string, answers: Answer[]): Promise<void> {
  const handled = new Set<string>();
  for (const answer of answers) {
    let held: SendRow | undefined;
    await vi.waitUntil(
      () => {
        held = ctx.services.taskSends
          .list(taskId)
          .sends.find(
            (row) => row.kind === "held" && row.status === "pending_live" && !handled.has(row.id),
          );
        return held !== undefined;
      },
      { timeout: 60_000, interval: 25 },
    );
    const row = held as SendRow;
    handled.add(row.id);
    if (answer === "nobody") continue;
    const decided = await decideRow(taskId, row.id, answer);
    expect(decided.status).toBe(200);
  }
}

export function decideRow(taskId: string, sendId: string, decision: "send" | "dont_send") {
  return ctx.call(API_ROUTES.taskSendDecide, {
    params: { id: taskId, sendId },
    body: { decision },
  });
}

export function approveNext(taskId: string, declineSendIds: string[] = []) {
  return ctx.call(API_ROUTES.taskApproveSubmit, {
    params: { id: taskId },
    body: { declineSendIds },
  });
}

export const rowsOf = (taskId: string) => ctx.services.taskSends.list(taskId).sends;
export const releasedOf = (taskId: string) =>
  rowsOf(taskId).filter((row) => row.kind === "released");

export const open = (path: string): Step => ({
  calls: [["navigate", { url: `${ORIGIN}${path}` }]],
});
export const fill: Step = (v) => ({
  calls: [
    ["type", { ref: v.ref("First name"), field: "first_name" }],
    ["type", { ref: v.ref("Last name"), field: "last_name" }],
    ["type", { ref: v.ref("Email address"), field: "email" }],
  ],
});
export const typeEmail: Step = (v) => ({
  calls: [["type", { ref: v.ref("Email address"), field: "email" }]],
});
export const chooseDelete: Step = (v) => ({
  calls: [["select", { ref: v.ref("Request type"), option: "Delete my data" }]],
});
export const snap: Turn = { calls: [["snapshot", {}]] };
export const clickLabel =
  (label: string, nth = 0): Step =>
  (v) => {
    const refs = v.snapshot
      .split("\n")
      .filter((line) => /^\[e\d+\]/.test(line) && line.includes(label))
      .map((line) => line.match(/^\[(e\d+)\]/)?.[1] ?? "");
    const ref = refs[nth];
    if (!ref) throw new Error(`no ${nth}th control ${label} in\n${v.snapshot}`);
    return { calls: [["click", { ref }]] };
  };
export const wait = (seconds: number): Step => ({ calls: [["wait", { seconds }]] });
export const report: Turn = {
  calls: [
    [
      "report",
      {
        status: "complete",
        result: {
          purpose: "remove",
          form: { outcome: "awaiting_email_confirmation", confirmationText: "Received" },
        },
      },
    ],
  ],
};
export const giveBack: Turn = { calls: [["report", { status: "release" }]] };

export const submitSteps = (...before: Step[]): Step[] => [
  open("/gate-form"),
  fill,
  chooseDelete,
  snap,
  ...before,
  clickLabel("Submit request"),
];

export async function firstLapse(taskId: string, steps: Step[] = submitSteps()) {
  return workOnce(taskId, steps);
}
