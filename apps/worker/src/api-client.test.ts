import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ClaimedTask, TaskSummary } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkerApiClient, WorkerApiError } from "./api-client.js";

interface Seen {
  method: string;
  url: string;
  authorization: string | undefined;
  body: unknown;
}

let server: Server;
let seen: Seen[];
let reply: { status: number; body: unknown };

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve(text ? JSON.parse(text) : null);
    });
  });
}

beforeEach(async () => {
  seen = [];
  reply = { status: 200, body: {} };
  server = createServer(async (request, response) => {
    seen.push({
      method: request.method ?? "",
      url: request.url ?? "",
      authorization: request.headers.authorization,
      body: await readBody(request),
    });
    response.writeHead(reply.status, { "content-type": "application/json" });
    response.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function client() {
  const { port } = server.address() as AddressInfo;
  return new WorkerApiClient({
    serverUrl: `http://127.0.0.1:${port}`,
    token: "secret-token-1234567",
    workerId: "worker-1",
  });
}

const summary: TaskSummary = {
  id: "t1",
  kind: "form",
  status: "done",
  priority: 20,
  profileId: "p1",
  targetId: "spokeo",
  targetName: "Spokeo",
  requestId: "r1",
  blockedReason: null,
  blockedDetail: null,
  blockedUrl: null,
  failureKind: null,
  failureStep: null,
  finishedBy: "worker-1",
  claimerKind: "builtin",
  usage: null,
  attempts: 1,
  maxAttempts: 3,
  lastError: null,
  hasScreenshot: false,
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T00:00:00.000Z",
};

describe("WorkerApiClient", () => {
  it("sends the bearer token and worker id on a heartbeat", async () => {
    reply.body = { ok: true, serverTime: "2026-10-07T00:00:00.000Z" };
    await client().heartbeat({ busy: false, currentTaskId: null, version: "1.2.3" });
    expect(seen).toEqual([
      {
        method: "POST",
        url: "/api/worker/heartbeat",
        authorization: "Bearer secret-token-1234567",
        body: { workerId: "worker-1", busy: false, currentTaskId: null, version: "1.2.3" },
      },
    ]);
  });

  it("claims with the browser kinds and returns null when idle", async () => {
    reply.body = { task: null };
    expect(await client().claim(["scan", "form"], 60_000)).toBeNull();
    expect(seen[0]).toMatchObject({
      url: "/api/worker/claim",
      body: { workerId: "worker-1", kinds: ["scan", "form"], leaseMs: 60_000 },
    });
  });

  it("returns a claimed task validated against the shared schema", async () => {
    const task: ClaimedTask = {
      id: "t1",
      kind: "confirm",
      attempt: 1,
      leaseExpiresAt: "2026-10-07T00:05:00.000Z",
      payload: { requestId: "r1", url: "https://spokeo.test/confirm" },
      target: {
        id: "spokeo",
        kind: "broker",
        name: "Spokeo",
        category: "people-search",
        domain: "spokeo.com",
        website: null,
        optOutUrl: null,
        searchUrl: null,
        contactMethod: "form",
        requiresId: false,
        requirements: [],
        priority: "normal",
        needsRecord: false,
        retired: false,
      },
      recipe: null,
      fields: {},
      instructions: "Open the link.",
    };
    reply.body = { task };
    expect(await client().claim()).toEqual(task);
  });

  it("rejects a response that breaks the contract", async () => {
    reply.body = { task: { id: "t1", kind: "email_send" } };
    await expect(client().claim()).rejects.toThrow();
  });

  it("puts the task id in the path and encodes it", async () => {
    reply.body = { leaseExpiresAt: "2026-10-07T00:05:00.000Z" };
    await client().taskHeartbeat("a/b");
    expect(seen[0]).toMatchObject({
      url: "/api/worker/tasks/a%2Fb/heartbeat",
      body: { workerId: "worker-1" },
    });
  });

  it("posts a result, a block with evidence, and a failure", async () => {
    reply.body = { task: summary };
    await client().complete("t1", { outcome: "submitted" });
    await client().block("t1", {
      reason: "captcha",
      detail: "reCAPTCHA",
      screenshot: { mime: "image/png", dataBase64: "iVBORw0KGgo=" },
    });
    await client().fail("t1", { error: "selector missing", retryable: true });
    expect(seen.map((s) => s.url)).toEqual([
      "/api/worker/tasks/t1/complete",
      "/api/worker/tasks/t1/block",
      "/api/worker/tasks/t1/fail",
    ]);
    expect(seen[0]?.body).toEqual({ workerId: "worker-1", result: { outcome: "submitted" } });
    expect(seen[1]?.body).toMatchObject({ workerId: "worker-1", reason: "captcha" });
    expect(seen[2]?.body).toEqual({
      workerId: "worker-1",
      error: "selector missing",
      retryable: true,
    });
  });

  it("reports what a run cost and what broke, and hands a task back", async () => {
    reply.body = { task: summary };
    await client().complete("t1", { outcome: "submitted" }, { durationMs: 1200 });
    await client().fail("t1", {
      error: "expect_text did not hold",
      retryable: false,
      kind: "recipe",
      step: 4,
    });
    await client().release("t1", 60_000);
    await client().release("t1");
    expect(seen.map((s) => s.url)).toEqual([
      "/api/worker/tasks/t1/complete",
      "/api/worker/tasks/t1/fail",
      "/api/worker/tasks/t1/release",
      "/api/worker/tasks/t1/release",
    ]);
    expect(seen[0]?.body).toMatchObject({ usage: { durationMs: 1200 } });
    expect(seen[1]?.body).toMatchObject({ kind: "recipe", step: 4, retryable: false });
    expect(seen[2]?.body).toEqual({ workerId: "worker-1", retryAfterMs: 60_000 });
    expect(seen[3]?.body).toEqual({ workerId: "worker-1" });
  });

  it("turns an error body into a typed error", async () => {
    reply = {
      status: 409,
      body: { error: "lease_not_held", message: "Another worker holds this task" },
    };
    const error = await client()
      .complete("t1", {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkerApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "lease_not_held",
      message: "Another worker holds this task",
    });
  });

  it("copes with an error that has no json body", async () => {
    reply = { status: 502, body: "bad gateway" };
    const error = await client()
      .heartbeat({ busy: false })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: "unknown_error" });
  });
});
