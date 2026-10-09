import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createTestContext,
  seedMailbox,
  seedProfile,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../../server/src/test-utils/index.js";
import { ORIGIN } from "./fixtures/server.js";
import { describeBrowser, fixtureState, resetFixture } from "./support.js";

vi.setConfig({ testTimeout: 120_000 });

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = "/gate-keepalive#fetch";

/**
 * A model server that plays one fixed script: open the page, type the email, then wait. It reads
 * the page's snapshot out of the conversation the way a real model does, so the run is the same
 * one the worker makes for a person.
 */
function startModel(): Promise<{ server: Server; baseUrl: string }> {
  let turn = 0;
  const call = (name: string, args: object) => ({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: `call_${turn}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
  const emailRef = (messages: { role: string; content?: string }[]): string => {
    for (const message of [...messages].reverse()) {
      if (message.role !== "tool" || !message.content?.includes("<page>")) continue;
      const line = message.content
        .split("\n")
        .find((l) => /^\[e\d+\]/.test(l) && l.includes("Email address"));
      const ref = line?.match(/^\[(e\d+)\]/)?.[1];
      if (ref) return ref;
    }
    throw new Error("the page has no email field in the conversation");
  };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      turn += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as {
        messages?: { role: string; content?: string }[];
      };
      const answer =
        turn === 1
          ? call("navigate", { url: `${ORIGIN}${PAGE}` })
          : turn === 2
            ? call("type", { ref: emailRef(body.messages ?? []), field: "email" })
            : call("wait", { seconds: 30 });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(answer));
    });
  });
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      done({ server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` });
    });
  });
}

let ctx: TestContext;
let model: Server | null = null;
let worker: ChildProcess | null = null;
let profileDir: string;

beforeEach(async () => {
  profileDir = mkdtempSync(join(tmpdir(), "kickrocks-signal-"));
  await resetFixture();
});
afterEach(async () => {
  worker?.kill("SIGKILL");
  worker = null;
  model?.close();
  model = null;
  await ctx?.app.close().catch(() => undefined);
  await ctx?.close().catch(() => undefined);
  // The orphaned Chrome of a killed worker is still closing its profile.
  await new Promise((done) => setTimeout(done, 1_000));
  rmSync(profileDir, { recursive: true, force: true });
});

async function startWorker(): Promise<{ taskId: string; child: ChildProcess }> {
  ctx = await createTestContext();
  const profileId = seedProfile(ctx).id;
  seedMailbox(ctx, profileId);
  const target = seedTarget(ctx, {
    contactMethod: "form",
    category: "marketing",
    domain: "127.0.0.1",
    optOutUrl: `${ORIGIN}${PAGE}`,
    website: `${ORIGIN}/`,
  });
  const request = seedRequest(ctx, {
    profileId,
    targetId: target.id,
    status: "queued",
    channel: "form",
  });
  ctx.services.dispatch.dispatchRequest(request.id);
  const serverUrl = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  const task = ctx.services.taskQueue
    .list({ kinds: ["agent"], status: "queued" })
    .find((t) => t.kind === "agent");
  if (!task) throw new Error("no agent task was queued");

  const started = await startModel();
  model = started.server;
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: PACKAGE_DIR,
    env: {
      ...process.env,
      KICKROCKS_SERVER_URL: serverUrl,
      KICKROCKS_WORKER_TOKEN: ctx.workerToken,
      KICKROCKS_WORKER_ID: "signal-agent",
      KICKROCKS_WORKER_POLL_MS: "500",
      KICKROCKS_AGENT_PROVIDER: "openai",
      KICKROCKS_AGENT_MODEL: "scripted",
      KICKROCKS_AGENT_BASE_URL: started.baseUrl,
      KICKROCKS_CHROME_PROFILE: profileDir,
      KICKROCKS_WORKER_HEADLESS: "true",
      KICKROCKS_WORKER_ALLOW_HTTP: "true",
      KICKROCKS_WORKER_PACE: "instant",
      LOG_LEVEL: "error",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  worker = child;
  return { taskId: task.id, child };
}

/** Waits until the page's keepalive fetch is held for a person, which is when a kill would let it go. */
async function untilHeld(taskId: string): Promise<void> {
  await vi.waitUntil(
    () =>
      ctx.services.taskSends
        .list(taskId)
        .sends.some((row) => row.kind === "held" && row.status === "pending_live"),
    { timeout: 90_000, interval: 50 },
  );
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) done();
    else child.once("exit", () => done());
  });
}

async function nothingReachedTheSite(): Promise<void> {
  await new Promise((done) => setTimeout(done, 3_000));
  const { hits, submissions } = await fixtureState();
  expect(hits.filter((hit) => hit.path.startsWith("/gate-v-ka-"))).toEqual([]);
  expect(submissions).toEqual([]);
}

describeBrowser("a real worker process that is stopped while a keepalive fetch is held", () => {
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    it(`sends nothing when it gets ${signal}`, async () => {
      const { taskId, child } = await startWorker();
      await untilHeld(taskId);
      child.kill(signal);
      await exited(child);
      await nothingReachedTheSite();
    });
  }

  it("sends nothing when it is killed", async () => {
    const { taskId, child } = await startWorker();
    await untilHeld(taskId);
    child.kill("SIGKILL");
    await exited(child);
    await nothingReachedTheSite();
  });
});
