import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TaskBlockBody,
  TaskCompleteBody,
  TaskFailBody,
  TaskReleaseBody,
  WorkerClaimBody,
} from "@kickrocks/shared";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentWorkerConfig } from "../src/config.js";
import { ProviderError } from "../src/provider.js";
import { markClaimsAsModel, runAgentWorker } from "../src/worker.js";
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
}

function fakeServer(task: ReturnType<typeof agentTask> | null) {
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
    });
    if (url.pathname === "/api/worker/heartbeat") {
      return json({ ok: true, serverTime: "2026-10-07T00:00:00.000Z" });
    }
    if (url.pathname === "/api/worker/claim") {
      const next = !given ? task : null;
      given = true;
      return json({ task: next });
    }
    if (url.pathname.endsWith("/heartbeat")) {
      return json({ leaseExpiresAt: "2026-10-07T00:10:00.000Z" });
    }
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
  const controller = new AbortController();
  const provider = options.provider ?? scripted(steps);
  const finished = runAgentWorker({
    config: config(),
    signal: controller.signal,
    logger: silentLogger,
    provider,
    fetch: server.fetch,
    launcher: options.launcher ?? (() => browser.newContext()),
    timing: { idleHeartbeatMs: 10_000, leaseHeartbeatMs: 1_000, reportRetryMs: 1 },
    challengeGraceMs: 200,
  });
  await vi.waitUntil(() => server.transitions().length > 0, { timeout: 20_000, interval: 20 });
  controller.abort();
  await finished;
  return provider;
}

describe("markClaimsAsModel", () => {
  it("adds claimer model to the claim body and nothing else", async () => {
    const base = vi.fn(async () => new Response("{}"));
    const marked = markClaimsAsModel(base as unknown as typeof fetch);
    await marked("http://s/api/worker/claim", {
      method: "POST",
      body: JSON.stringify({ workerId: "w", kinds: ["agent"] }),
    });
    const sent = base.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(sent[1].body))).toEqual({
      workerId: "w",
      kinds: ["agent"],
      claimer: "model",
    });
    expect(WorkerClaimBody.parse(JSON.parse(String(sent[1].body))).claimer).toBe("model");
  });

  it("leaves every other request alone", async () => {
    const base = vi.fn(async () => new Response("{}"));
    const marked = markClaimsAsModel(base as unknown as typeof fetch);
    const init = { method: "POST", body: JSON.stringify({ workerId: "w", busy: false }) };
    await marked(new URL("http://s/api/worker/heartbeat"), init);
    await marked("http://s/api/worker/tasks/t1/complete", init);
    await marked("http://s/api/worker/claim", { method: "GET" });
    for (const call of base.mock.calls as unknown as [unknown, RequestInit][]) {
      expect(call[1]?.body === undefined || !String(call[1].body).includes("claimer")).toBe(true);
    }
  });
});

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
    });
    expect(claim?.authorization).toBe("Bearer a-token-of-sixteen-chars");

    const [complete] = server.transitions();
    expect(complete?.path).toBe(`/api/worker/tasks/${task.id}/complete`);
    const body = TaskCompleteBody.parse(complete?.body);
    expect(body.result).toEqual(result);
    expect(body.usage).toMatchObject({ inputTokens: 400, outputTokens: 80 });
    expect(body.usage?.durationMs).toBeGreaterThan(0);
    expect(body.usage?.costUsd).toBeCloseTo((400 * 1 + 80 * 2) / 1_000_000, 10);

    const { submissions } = await fixtureState();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.fields).toMatchObject({
      first_name: "Jordan",
      last_name: "Example",
      email: "jordan.example@example.com",
    });
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
});
