import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_ROUTES, type SendRow } from "@kickrocks/shared";
import { BROWSER_CONTEXT_OPTIONS } from "@kickrocks/worker/dist/browser.js";
import { createLogger } from "@kickrocks/worker/dist/logger.js";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import {
  describeBrowser,
  fixtureState,
  launchTestBrowser,
  resetFixture,
  type Step,
  scripted,
} from "./support.js";

vi.setConfig({ testTimeout: 120_000 });

const debugLogger = createLogger(process.env.GATE_LOG === "1" ? "debug" : "error");
const SERVER_PORT = Number(process.env.GATE_SERVER_PORT ?? 8772);
/** Long enough that a person (the test) can answer, short enough that a lapse is quick. */
const ANSWER_MS = 30_000;
const LAPSE_MS = 1_200;

let browser: Browser;
let ctx: TestContext;
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
    serverUrl: `http://127.0.0.1:${SERVER_PORT}`,
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
async function startServer(path = "/gate-form", twoHosts = false): Promise<string> {
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
  await ctx.app.listen({ port: SERVER_PORT, host: "127.0.0.1" });
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
async function workOnce(taskId: string, steps: Step[], options: WorkOptions = {}) {
  const controller = new AbortController();
  const claimed = vi.fn();
  const finished = runAgentWorker({
    config: config(),
    signal: controller.signal,
    logger: debugLogger,
    provider: scripted(steps),
    launcher: () => browser.newContext(BROWSER_CONTEXT_OPTIONS),
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
  await vi.waitUntil(
    () => {
      const status = ctx.services.taskQueue.getOrThrow(taskId).status;
      if (status === "leased") claimed();
      return claimed.mock.calls.length > 0 && status !== "leased";
    },
    { timeout: 90_000, interval: 25 },
  );
  controller.abort();
  await finished;
  return ctx.services.taskQueue.getOrThrow(taskId);
}

type Answer = "send" | "dont_send" | "nobody";

/**
 * Answers the requests a run holds, one answer for each, through the same route the review page
 * uses. `nobody` leaves a request alone so that it lapses.
 */
async function answerHolds(taskId: string, answers: Answer[]): Promise<void> {
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

function decideRow(taskId: string, sendId: string, decision: "send" | "dont_send") {
  return ctx.call(API_ROUTES.taskSendDecide, {
    params: { id: taskId, sendId },
    body: { decision },
  });
}

function approveNext(taskId: string, declineSendIds: string[] = []) {
  return ctx.call(API_ROUTES.taskApproveSubmit, {
    params: { id: taskId },
    body: { declineSendIds },
  });
}

const rowsOf = (taskId: string) => ctx.services.taskSends.list(taskId).sends;
const releasedOf = (taskId: string) => rowsOf(taskId).filter((row) => row.kind === "released");

const open = (path: string): Step => ({ calls: [["navigate", { url: `${ORIGIN}${path}` }]] });
const fill: Step = (v) => ({
  calls: [
    ["type", { ref: v.ref("First name"), field: "first_name" }],
    ["type", { ref: v.ref("Last name"), field: "last_name" }],
    ["type", { ref: v.ref("Email address"), field: "email" }],
  ],
});
const typeEmail: Step = (v) => ({
  calls: [["type", { ref: v.ref("Email address"), field: "email" }]],
});
const chooseDelete: Step = (v) => ({
  calls: [["select", { ref: v.ref("Request type"), option: "Delete my data" }]],
});
const snap: Step = { calls: [["snapshot", {}]] };
const clickLabel =
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
const wait = (seconds: number): Step => ({ calls: [["wait", { seconds }]] });
const report: Step = {
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
const giveBack: Step = { calls: [["report", { status: "release" }]] };

const submitSteps = (...before: Step[]): Step[] => [
  open("/gate-form"),
  fill,
  chooseDelete,
  snap,
  ...before,
  clickLabel("Submit request"),
];

async function firstLapse(taskId: string, steps: Step[] = submitSteps()) {
  return workOnce(taskId, steps);
}

describeBrowser("the outgoing gate end to end with the real server", () => {
  describe("a baseline run", () => {
    it("holds the form, sends exactly the request that was captured once a person says send, and finishes", async () => {
      const taskId = await startServer();
      const answered = answerHolds(taskId, ["send"]);
      const done = await workOnce(taskId, [...submitSteps(), report], { holdMs: ANSWER_MS });
      await answered;

      expect(done).toMatchObject({
        status: "done",
        mayHaveSubmitted: true,
        submitApproval: "required",
      });
      const { submissions } = await fixtureState();
      expect(submissions).toHaveLength(1);
      expect(submissions[0]).toMatchObject({
        path: "/gate-optout",
        fields: {
          kind: "delete",
          action: "optout",
          share: "no",
          scope: "this-site",
          email: "jordan@example.com",
        },
      });
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(held).toHaveLength(1);
      expect(held[0]).toMatchObject({ status: "sent", decidedBy: "user", hasScreenshot: true });
      const released = releasedOf(taskId);
      expect(released).toHaveLength(1);
      expect(released[0]).toMatchObject({ status: "sent", responseStatus: 200 });
      const request = released[0]?.request;
      expect(
        request && "body" in request ? request.body.map((value) => value.path).sort() : [],
      ).toEqual(Object.keys(submissions[0]?.fields ?? {}).sort());
    });

    it("shows the person's values in a held request where the page was given them", async () => {
      const taskId = await startServer();
      const answered = answerHolds(taskId, ["dont_send"]);
      const done = await workOnce(taskId, [...submitSteps(), giveBack], { holdMs: ANSWER_MS });
      await answered;
      expect(done.status).not.toBe("done");
      const log = await ctx.call(API_ROUTES.taskSends, { params: { id: taskId } });
      expect(log.ok && log.body.values["{{email}}"]).toBe("jordan@example.com");
      expect((await fixtureState()).submissions).toEqual([]);
    });

    it("lets the run lapse when nobody is home, then sends the approved request once in the next run", async () => {
      const taskId = await startServer();
      const first = await firstLapse(taskId);
      expect(first).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
      const waiting = rowsOf(taskId).filter((row) => row.status === "awaiting_next_run");
      expect(waiting).toHaveLength(1);

      expect((await approveNext(taskId)).ok).toBe(true);
      const done = await workOnce(taskId, [...submitSteps(), report]);

      expect(done.status).toBe("done");
      const { submissions } = await fixtureState();
      expect(submissions).toHaveLength(1);
      expect(rowsOf(taskId).find((row) => row.id === waiting[0]?.id)?.status).toBe("spent");
      const released = releasedOf(taskId);
      expect(released).toHaveLength(1);
      expect(released[0]?.spendsSendId).toBe(waiting[0]?.id);
    });

    it("sends nothing in a run that was declined, and the run goes on to report", async () => {
      const taskId = await startServer();
      const answered = answerHolds(taskId, ["dont_send"]);
      const done = await workOnce(taskId, [...submitSteps(), giveBack], { holdMs: ANSWER_MS });
      await answered;
      expect(done.status).toBe("queued");
      expect((await fixtureState()).submissions).toEqual([]);
      expect(rowsOf(taskId).find((row) => row.kind === "held")?.status).toBe("declined");
    });
  });

  describe("a send the page makes on its own", () => {
    it("holds a debounced autosave that fires after the guard window used to have closed", async () => {
      const taskId = await startServer("/gate-delayed");
      const done = await workOnce(taskId, [
        open("/gate-delayed"),
        typeEmail,
        wait(2),
        snap,
        giveBack,
      ]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(held.map((row) => row.status)).toEqual(["awaiting_next_run"]);
      expect(held[0]?.request).toMatchObject({ path: "/gate-autosave", method: "POST" });
    });

    it("sends nothing when the person declines it, and nothing at 0, 1.5 and 10 seconds", async () => {
      const taskId = await startServer("/gate-delayed");
      const answered = answerHolds(taskId, ["dont_send"]);
      await workOnce(taskId, [open("/gate-delayed"), typeEmail, wait(3), giveBack], {
        holdMs: ANSWER_MS,
      });
      await answered;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect((await fixtureState()).submissions).toEqual([]);
    });

    it("does not let a pagehide beacon or a late timer out after an immediate report", async () => {
      const taskId = await startServer("/gate-beacon");
      await workOnce(taskId, [open("/gate-beacon"), typeEmail, giveBack]);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const paths = (await fixtureState()).hits.map((hit) => hit.path);
      expect(paths).not.toContain("/gate-beacon-post");
      expect(paths).not.toContain("/gate-late-post");
    });

    it("holds a form.submit() fired during a wait, and the lapse is never a failure to retry", async () => {
      const taskId = await startServer("/gate-delayed-submit");
      const done = await workOnce(taskId, [open("/gate-delayed-submit"), typeEmail, wait(2), snap]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(done.attempts).toBe(1);
      expect((await fixtureState()).submissions).toEqual([]);
    });
  });

  describe("what the page sends besides a form", () => {
    it("holds a GET fetch and an image, and logs the held ones with the email hidden", async () => {
      const taskId = await startServer("/gate-get");
      const done = await workOnce(taskId, [open("/gate-get"), typeEmail, wait(1), snap, giveBack]);
      expect(done.status).toBe("blocked");
      const state = await fixtureState();
      expect(state.hits.filter((hit) => hit.path === "/gate-collect")).toEqual([]);
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(held.length).toBeGreaterThan(0);
      expect(JSON.stringify(held.map((row) => row.request))).not.toContain("jordan@example.com");
    });

    it("refuses a value sent to another site and never offers it for approval", async () => {
      const taskId = await startServer("/gate-cross", true);
      await workOnce(taskId, [open("/gate-cross"), typeEmail, wait(2), giveBack]);
      expect((await fixtureState()).hits.filter((hit) => hit.host === "other.test")).toEqual([]);
      const refused = rowsOf(taskId).filter((row) => row.kind === "refused");
      expect(refused.map((row) => row.reason)).toContain("third_party_value");
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(held.every((row) => "party" in row.request && row.request.party === "target")).toBe(
        true,
      );
    });

    it("stops with the live connection copy and receives no frame", async () => {
      const taskId = await startServer("/gate-ws");
      const done = await workOnce(taskId, [open("/gate-ws"), typeEmail, wait(2), giveBack]);
      expect((await fixtureState()).wsFrames).toEqual([]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "unapproved_submit" });
      expect(done.blockedDetail).toContain("live connection");
      expect(done.mayHaveSubmitted).toBe(true);
    });
  });

  describe("the same-label second form", () => {
    it("is not approved by the approval of the first form", async () => {
      const taskId = await startServer();
      await firstLapse(taskId);
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [
        ...submitSteps().slice(0, -1),
        clickLabel("Submit request", 1),
        giveBack,
      ]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      const { submissions } = await fixtureState();
      expect(submissions.filter((submission) => submission.path === "/gate-newsletter")).toEqual(
        [],
      );
      expect(submissions).toEqual([]);
    });
  });

  describe("a run that differs from what was approved", () => {
    it.each([
      [
        "a different option",
        [
          (v: { ref: (l: string) => string }) => ({
            calls: [["select", { ref: v.ref("Request type"), option: "Access my data" }]],
          }),
        ],
      ],
      [
        "an extra tick",
        [
          (v: { ref: (l: string) => string }) => ({
            calls: [["check", { ref: v.ref("Send me offers"), checked: true }]],
          }),
        ],
      ],
    ])("is held again for %s", async (_, extra) => {
      const taskId = await startServer();
      await firstLapse(taskId);
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [
        open("/gate-form"),
        fill,
        chooseDelete,
        ...(extra as Step[]),
        snap,
        clickLabel("Submit request"),
        giveBack,
      ]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
    });

    it.each([
      ["a div role=checkbox", "Share my details with partners"],
      ["a type=button toggle", "Include partner brands"],
      ["a role=switch", "Send me alerts"],
      ["an aria-pressed button", "Pin my listing"],
      ["a label that acts like a button", "Sync my other accounts"],
      ["a tab", "Advanced options"],
    ])("is held again when %s flips a hidden field", async (_, control) => {
      const taskId = await startServer("/gate-custom");
      await workOnce(taskId, [open("/gate-custom"), typeEmail, snap, clickLabel("Submit request")]);
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [
        open("/gate-custom"),
        snap,
        clickLabel(control),
        typeEmail,
        snap,
        clickLabel("Submit request"),
        giveBack,
      ]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
    });
  });

  describe("tokens the site changes on every load", () => {
    it("matches a replay whose per-load token differs, and sends it once", async () => {
      const taskId = await startServer("/gate-csrf");
      const steps = [open("/gate-csrf"), typeEmail, snap, clickLabel("Submit request")];
      await workOnce(taskId, steps);
      expect((await approveNext(taskId)).ok).toBe(true);
      const done = await workOnce(taskId, [...steps, report]);
      expect(done.status).toBe("done");
      const { submissions } = await fixtureState();
      expect(submissions).toHaveLength(1);
      expect(submissions[0]?.fields.csrf).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    });

    it("holds a long random value that a click set, which the site did not serve", async () => {
      const taskId = await startServer("/gate-csrf");
      await workOnce(taskId, [open("/gate-csrf"), typeEmail, snap, clickLabel("Submit request")]);
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [
        open("/gate-csrf"),
        typeEmail,
        snap,
        clickLabel("Prepare request"),
        clickLabel("Submit request"),
        giveBack,
      ]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
    });
  });

  describe("a form with two steps", () => {
    const steps = (): Step[] => [
      open("/gate-step1"),
      typeEmail,
      snap,
      clickLabel("Continue"),
      snap,
      clickLabel("Confirm removal"),
    ];

    it("asks for each step in the same run and finishes after both are approved", async () => {
      const taskId = await startServer("/gate-step1");
      const answered = answerHolds(taskId, ["send", "send"]);
      const done = await workOnce(taskId, [...steps(), report], { holdMs: ANSWER_MS });
      await answered;
      expect(done.status).toBe("done");
      const { submissions } = await fixtureState();
      expect(submissions.map((submission) => submission.path)).toEqual([
        "/gate-step1-post",
        "/gate-step2-post",
      ]);
      expect(releasedOf(taskId)).toHaveLength(2);
    });

    it("sends step 1 again, then step 2, when the run lapsed at step 2 and the next run is approved", async () => {
      const taskId = await startServer("/gate-step1");
      const answered = answerHolds(taskId, ["send", "nobody"]);
      const first = await workOnce(taskId, steps(), { holdMs: 4_000 });
      await answered;
      expect(first).toMatchObject({
        status: "blocked",
        blockedReason: "approval_needed",
        mayHaveSubmitted: true,
      });
      expect((await fixtureState()).submissions.map((s) => s.path)).toEqual(["/gate-step1-post"]);

      expect((await approveNext(taskId)).ok).toBe(true);
      const log = ctx.services.taskSends.gateFor(taskId);
      expect(log.approved.map((entry) => [entry.request.path, entry.resend])).toEqual([
        ["/gate-step1-post", true],
        ["/gate-step2-post", false],
      ]);

      const done = await workOnce(taskId, [...steps(), report]);
      expect(done.status).toBe("done");
      expect((await fixtureState()).submissions.map((s) => s.path)).toEqual([
        "/gate-step1-post",
        "/gate-step1-post",
        "/gate-step2-post",
      ]);
    });
  });

  describe("the screenshot of a held send", () => {
    function pngHeight(data: Buffer): number {
      return data.readUInt32BE(20);
    }

    it("shows the whole page, with the submit button below the fold", async () => {
      const taskId = await startServer("/gate-long");
      await workOnce(taskId, [open("/gate-long"), typeEmail, snap, clickLabel("Submit request")]);
      const held = rowsOf(taskId).find((row) => row.kind === "held");
      const shot = ctx.services.taskSends.screenshot(taskId, held?.id ?? "");
      expect(shot?.mime).toBe("image/png");
      expect(pngHeight(shot?.data ?? Buffer.alloc(24))).toBeGreaterThan(3_000);
    });

    it("falls back to the part of the page the run acted on when the whole page is too large", async () => {
      const taskId = await startServer("/gate-noisy");
      await workOnce(taskId, [open("/gate-noisy"), typeEmail, snap, clickLabel("Submit request")], {
        maxScreenshotBytes: 400_000,
      });
      const held = rowsOf(taskId).find((row) => row.kind === "held");
      const shot = ctx.services.taskSends.screenshot(taskId, held?.id ?? "");
      expect(shot).not.toBeNull();
      expect(shot?.data.length).toBeLessThanOrEqual(400_000);
      const height = shot?.mime === "image/png" ? pngHeight(shot.data) : 0;
      expect(height).toBeLessThan(1_200);
    });
  });
});
