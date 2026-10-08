import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TaskBlockBody,
  TaskCompleteBody,
  TaskFailBody,
  TaskHeartbeatBody,
  TaskReleaseBody,
  WorkerClaimBody,
  WorkerHeartbeatBody,
} from "@kickrocks/shared";
import { ProxyConflictError } from "@kickrocks/worker/dist/browser.js";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { AgentWorkerConfig } from "../src/config.js";
import { ProviderError } from "../src/provider.js";
import { runAgentWorker } from "../src/worker.js";
import { ORIGIN } from "./fixtures/server.js";
import {
  agentTask,
  describeBrowser,
  fixtureState,
  launchTestBrowser,
  resetFixture,
  type Step,
  scripted,
  silentLogger,
  summary,
} from "./support.js";

interface Seen {
  path: string;
  authorization: string | null;
  body: unknown;
  /** How many forms the fixture site had taken when this request reached the server. */
  submissionsSoFar: number;
}

function fakeServer(task: ReturnType<typeof agentTask> | null, profileIds?: string[]) {
  const seen: Seen[] = [];
  let given = false;
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const headers = init?.headers as Record<string, string>;
    seen.push({
      path: url.pathname,
      authorization: headers.authorization ?? null,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      submissionsSoFar: (await fixtureState()).submissions.length,
    });
    if (url.pathname === "/api/worker/heartbeat") {
      return json({ ok: true, serverTime: "2026-10-07T00:00:00.000Z", profileIds });
    }
    if (url.pathname === "/api/worker/claim") {
      const next = !given ? task : null;
      given = true;
      return json({ task: next });
    }
    if (url.pathname.endsWith("/heartbeat")) {
      return json({ leaseExpiresAt: "2026-10-07T00:10:00.000Z" });
    }
    if (url.pathname.endsWith("/sends")) {
      const items = (JSON.parse(String(init?.body)) as { items: { kind: string }[] }).items;
      return json({
        sends: items.map((item, index) => ({
          id: `send-${seen.length}-${index}`,
          status: item.kind === "held" ? "pending_live" : "done",
          expiresAt: null,
        })),
      });
    }
    if (url.pathname.endsWith("/decision")) return json({ status: "expired" });
    return json({ task: summary(task?.id ?? "x") });
  };
  return {
    fetch: impl as typeof fetch,
    seen,
    transitions: () =>
      seen.filter((entry) => /\/tasks\/[^/]+\/(complete|block|fail|release)$/.test(entry.path)),
  };
}

let browser: Browser;
let profileDir: string;

beforeAll(async () => {
  browser = await launchTestBrowser();
});

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  profileDir = mkdtempSync(join(tmpdir(), "kickrocks-agent-"));
  await resetFixture();
});

afterEach(() => {
  rmSync(profileDir, { recursive: true, force: true });
});

function config(): AgentWorkerConfig {
  return {
    serverUrl: "http://server.test",
    token: "a-token-of-sixteen-chars",
    workerId: "test-agent",
    pollMs: 5,
    leaseMs: 60_000,
    provider: {
      kind: "openai",
      model: "scripted-model",
      baseUrl: "http://localhost:11434/v1",
      apiKey: null,
      maxOutputTokens: 1024,
      tokenParam: "max_tokens",
      numCtx: 16_384,
      thinking: "default",
    },
    pricing: { inputUsdPerMtok: 1, outputUsdPerMtok: 2 },
    limits: { maxSteps: 30, maxMs: 60_000, maxTotalTokens: null },
    chromeProfileDir: profileDir,
    headless: true,
    noSandbox: false,
    allowHttp: true,
    pace: "instant",
    chromeExecutable: null,
    logLevel: "error",
  };
}

async function runOnce(
  server: ReturnType<typeof fakeServer>,
  steps: Step[],
  options: { launcher?: () => Promise<never>; provider?: ReturnType<typeof scripted> } = {},
) {
  const { finished, controller, provider } = startWorker(server, steps, options);
  await vi.waitUntil(() => server.transitions().length > 0, { timeout: 20_000, interval: 20 });
  controller.abort();
  await finished;
  return provider;
}

function startWorker(
  server: ReturnType<typeof fakeServer>,
  steps: Step[],
  options: { launcher?: () => Promise<never>; provider?: ReturnType<typeof scripted> } = {},
) {
  const controller = new AbortController();
  const provider = options.provider ?? scripted(steps);
  const finished = runAgentWorker({
    config: config(),
    signal: controller.signal,
    logger: silentLogger,
    provider,
    fetch: server.fetch,
    launcher: options.launcher ?? (() => browser.newContext()),
    timing: {
      idleHeartbeatMs: 10_000,
      leaseHeartbeatMs: 1_000,
      reportRetryMs: 1,
      shutdownGraceMs: 300,
    },
    challengeGraceMs: 200,
  });
  return { finished, controller, provider };
}

describeBrowser("the agent worker end to end", () => {
  it("claims as a model, drives the page, and completes the task with usage", async () => {
    const task = agentTask();
    const server = fakeServer(task);
    const result = {
      purpose: "remove",
      form: { outcome: "awaiting_email_confirmation", confirmationText: "Check your email" },
    };
    await runOnce(server, [
      { calls: [["navigate", { url: `${ORIGIN}/optout` }]] },
      (v) => ({
        calls: [
          ["type", { ref: v.ref("First name"), field: "first_name" }],
          ["type", { ref: v.ref("Last name"), field: "last_name" }],
          ["type", { ref: v.ref("Email address"), field: "email" }],
        ],
      }),
      (v) => ({ calls: [["click", { ref: v.ref("Submit request") }]] }),
      { calls: [["report", { status: "complete", result }]] },
    ]);

    const claim = server.seen.find((entry) => entry.path === "/api/worker/claim");
    expect(WorkerClaimBody.parse(claim?.body)).toMatchObject({
      workerId: "test-agent",
      kinds: ["agent"],
      claimer: "model",
      model: { provider: "openai", name: "scripted-model", version: null, thinking: "default" },
    });
    expect(claim?.authorization).toBe("Bearer a-token-of-sixteen-chars");
    const beats = server.seen.filter((entry) => entry.path === "/api/worker/heartbeat");
    expect(beats.length).toBeGreaterThan(0);
    for (const beat of beats) {
      expect(WorkerHeartbeatBody.parse(beat.body)).toMatchObject({
        claimer: "model",
        model: { name: "scripted-model" },
      });
    }

    const [complete] = server.transitions();
    expect(complete?.path).toBe(`/api/worker/tasks/${task.id}/complete`);
    const body = TaskCompleteBody.parse(complete?.body);
    expect(body.result).toEqual(result);
    expect(body.usage).toMatchObject({ inputTokens: 400, outputTokens: 80 });
    expect(body.usage?.durationMs).toBeGreaterThan(0);
    expect(body.usage?.costUsd).toBeCloseTo((400 * 1 + 80 * 2) / 1_000_000, 10);

    const flagged = server.seen.find(
      (entry) =>
        entry.path === `/api/worker/tasks/${task.id}/heartbeat` &&
        (entry.body as { mayHaveSubmitted?: boolean }).mayHaveSubmitted === true,
    );
    expect(TaskHeartbeatBody.parse(flagged?.body).mayHaveSubmitted).toBe(true);
    expect(flagged?.submissionsSoFar).toBe(0);

    const { submissions } = await fixtureState();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.fields).toMatchObject({
      first_name: "Jordan",
      last_name: "Example",
      email: "jordan.example@example.com",
    });
  });

  it("stops a removal that needs approval at the send button without saying a form may have gone out", async () => {
    const task = agentTask({
      submitApproval: "required",
      submitGate: { mode: "hold", holdMs: 300, approved: [], declined: [] },
    });
    const server = fakeServer(task);
    await runOnce(server, [
      { calls: [["navigate", { url: `${ORIGIN}/optout` }]] },
      (v) => ({
        calls: [
          ["type", { ref: v.ref("First name"), field: "first_name" }],
          ["type", { ref: v.ref("Last name"), field: "last_name" }],
          ["type", { ref: v.ref("Email address"), field: "email" }],
        ],
      }),
      (v) => ({ calls: [["click", { ref: v.ref("Submit request") }]] }),
    ]);

    const flagged = server.seen.filter(
      (entry) =>
        entry.path === `/api/worker/tasks/${task.id}/heartbeat` &&
        (entry.body as { mayHaveSubmitted?: boolean }).mayHaveSubmitted === true,
    );
    expect(flagged).toHaveLength(0);
    const [block] = server.transitions();
    expect(block?.path).toBe(`/api/worker/tasks/${task.id}/block`);
    expect(TaskBlockBody.parse(block?.body)).toMatchObject({ reason: "approval_needed" });
    const held = server.seen.find(
      (entry) =>
        entry.path === `/api/worker/tasks/${task.id}/sends` &&
        (entry.body as { items: { kind: string }[] }).items[0]?.kind === "held",
    );
    expect(JSON.stringify(held?.body)).toContain("{{email}}");
    expect(JSON.stringify(held?.body)).not.toContain("jordan.example@example.com");
    expect((await fixtureState()).submissions).toHaveLength(0);
  });

  it("blocks the task with a screenshot when the page shows a CAPTCHA", async () => {
    const task = agentTask();
    const server = fakeServer(task);
    await runOnce(server, [{ calls: [["navigate", { url: `${ORIGIN}/captcha` }]] }]);

    const [block] = server.transitions();
    expect(block?.path).toBe(`/api/worker/tasks/${task.id}/block`);
    const body = TaskBlockBody.parse(block?.body);
    expect(body).toMatchObject({
      reason: "captcha",
      url: `${ORIGIN}/captcha`,
      workerId: "test-agent",
    });
    expect(body.screenshot?.mime).toBe("image/png");
    expect(body.usage?.inputTokens).toBe(100);
  });

  it("fails the task with its usage when the agent gives up", async () => {
    const task = agentTask();
    const server = fakeServer(task);
    await runOnce(server, [
      {
        calls: [
          ["report", { status: "failed", error: "The form never loads", failureKind: "site" }],
        ],
      },
    ]);
    const body = TaskFailBody.parse(server.transitions()[0]?.body);
    expect(body).toMatchObject({ error: "The form never loads", kind: "site", retryable: false });
    expect(body.usage?.outputTokens).toBe(20);
  });

  it("hands the task back for a later try when the model is unreachable", async () => {
    const server = fakeServer(agentTask());
    const provider = scripted([]);
    provider.complete = async () => {
      throw new ProviderError("The model endpoint could not be reached", "unavailable");
    };
    await runOnce(server, [], { provider });
    const body = TaskReleaseBody.parse(server.transitions()[0]?.body);
    expect(body.retryAfterMs).toBe(60_000);
    expect(server.transitions()[0]?.path).toMatch(/\/release$/);
  });

  it("hands the task back when the browser will not start", async () => {
    const server = fakeServer(agentTask());
    await runOnce(server, [], {
      launcher: async () => {
        throw new Error("no display");
      },
    });
    expect(TaskReleaseBody.parse(server.transitions()[0]?.body).retryAfterMs).toBe(60_000);
  });

  it("fails the task for good when its proxy cannot be combined with the worker's own", async () => {
    const server = fakeServer(agentTask());
    await runOnce(server, [], {
      launcher: async () => {
        throw new ProxyConflictError();
      },
    });
    const transition = server.transitions()[0];
    expect(transition?.path).toMatch(/\/fail$/);
    expect(TaskFailBody.parse(transition?.body)).toMatchObject({
      kind: "internal",
      retryable: false,
    });
  });

  it("holds a removal that clicked for a person when shutdown finds the run stalled", async () => {
    const task = agentTask();
    const server = fakeServer(task);
    const { finished, controller } = startWorker(server, [
      { calls: [["navigate", { url: `${ORIGIN}/optout` }]] },
      (v) => ({
        calls: [
          ["type", { ref: v.ref("First name"), field: "first_name" }],
          ["type", { ref: v.ref("Last name"), field: "last_name" }],
          ["type", { ref: v.ref("Email address"), field: "email" }],
        ],
      }),
      (v) => ({ calls: [["click", { ref: v.ref("Submit request") }]] }),
      { calls: [["navigate", { url: `${ORIGIN}/hang` }]] },
    ]);
    await vi.waitUntil(async () => (await fixtureState()).hits.some((h) => h.path === "/hang"), {
      timeout: 20_000,
      interval: 20,
    });
    controller.abort();
    await finished;

    const [report] = server.transitions();
    expect(report?.path).toBe(`/api/worker/tasks/${task.id}/block`);
    expect(TaskBlockBody.parse(report?.body)).toMatchObject({
      reason: "unknown",
      detail: expect.stringContaining("may already have been submitted"),
    });
    expect((await fixtureState()).submissions).toHaveLength(1);
  });

  it("deletes the browser data of a profile the server no longer has, between tasks", async () => {
    const server = fakeServer(null, ["profile-1"]);
    const kept = join(profileDir, "kickrocks", "profile-1");
    const gone = join(profileDir, "kickrocks", "profile-deleted");
    mkdirSync(kept, { recursive: true });
    mkdirSync(gone, { recursive: true });
    writeFileSync(join(gone, "Cookies"), "cookie data");

    const { finished, controller } = startWorker(server, []);
    await vi.waitUntil(() => !existsSync(gone), { timeout: 5_000, interval: 20 });
    controller.abort();
    await finished;
    expect(existsSync(kept)).toBe(true);
  });
});
