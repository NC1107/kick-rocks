import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ClaimedTask, TaskSummary } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServerUnreachableError, WorkerApiClient, WorkerApiError } from "./api-client.js";

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

function client(claimer?: "builtin" | "model") {
  const { port } = server.address() as AddressInfo;
  return new WorkerApiClient({
    serverUrl: `http://127.0.0.1:${port}`,
    token: "secret-token-1234567",
    workerId: "worker-1",
    ...(claimer ? { claimer } : {}),
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

  it("says which kind of worker it is on every heartbeat and claim, when it says so", async () => {
    reply.body = { ok: true, serverTime: "2026-10-07T00:00:00.000Z" };
    await client("model").heartbeat({ busy: false });
    reply.body = { task: null };
    await client("model").claim(["agent"]);
    expect(seen.map((call) => (call.body as { claimer?: string }).claimer)).toEqual([
      "model",
      "model",
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
        privacyRightsUrl: null,
        searchUrl: null,
        contactMethod: "form",
        requiresId: false,
        requirements: [],
        priority: "normal",
        needsRecord: false,
        californiaRegistered: false,
        difficulty: "easy",
        difficultyReasons: ["email", "no_record_needed"],
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
  describe("what counts as the server being unreachable", () => {
    it("is a refused connection", async () => {
      const closed = createServer();
      await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
      const { port } = closed.address() as AddressInfo;
      await new Promise<void>((resolve) => closed.close(() => resolve()));
      const lost = new WorkerApiClient({
        serverUrl: `http://127.0.0.1:${port}`,
        token: "secret-token-1234567",
        workerId: "worker-1",
      });
      await expect(lost.heartbeat({ busy: false })).rejects.toBeInstanceOf(ServerUnreachableError);
    });

    it("is an answer that is not json, as a proxy error page is", async () => {
      server.removeAllListeners("request");
      server.on("request", (_request, response) => {
        response.writeHead(500, { "content-type": "text/html" });
        response.end("<html>proxy error</html>");
      });
      await expect(client().heartbeat({ busy: false })).rejects.toBeInstanceOf(
        ServerUnreachableError,
      );
    });

    it("is not an error the server answered with", async () => {
      reply = { status: 500, body: { error: "internal", message: "boom" } };
      const error = await client()
        .complete("t1", {})
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WorkerApiError);
      expect(error).not.toBeInstanceOf(ServerUnreachableError);
    });

    it("is not a body that cannot be serialised or an answer that breaks the contract", async () => {
      const unserialisable = await client()
        .complete("t1", { count: 1n })
        .catch((e: unknown) => e);
      expect(unserialisable).toBeInstanceOf(TypeError);
      expect(unserialisable).not.toBeInstanceOf(ServerUnreachableError);
      expect(seen).toHaveLength(0);

      reply.body = { task: { id: "t1", kind: "email_send" } };
      const broken = await client()
        .claim()
        .catch((e: unknown) => e);
      expect(broken).not.toBeInstanceOf(ServerUnreachableError);
      expect(broken).toBeInstanceOf(Error);
    });
  });
});
