import { recipes, targets } from "@kickrocks/db";
import {
  API_ROUTES,
  MCP_TOOL_NAMES,
  MCP_TOOLS,
  SCREENSHOT_BODY_LIMIT_BYTES,
} from "@kickrocks/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeRecipe } from "../../test-utils/builders.js";
import {
  createTestContext,
  seedProfile,
  seedRecipe,
  seedTarget,
  seedTask,
  TEST_MCP_TOKEN,
  type TestContext,
} from "../../test-utils/index.js";

/** One red pixel, enough to be a real PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

let ctx: TestContext;
let url: URL;
const clients: Client[] = [];

beforeEach(async () => {
  ctx = await createTestContext();
  const address = await ctx.app.listen({ host: "127.0.0.1", port: 0 });
  url = new URL(`${address}/mcp`);
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await ctx.close();
});

async function connect(token: string = TEST_MCP_TOKEN): Promise<Client> {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  // The SDK declares an optional sessionId that the strict optional property setting rejects.
  await client.connect(transport as Transport);
  clients.push(client);
  return client;
}

/** The structured result of a tool call, failing the test when the tool reported an error. */
async function call<T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return result.structuredContent as T;
}

/** The error a tool reported, as the JSON an agent reads. */
async function callError(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ code: string; message?: string; issues?: { path: unknown[]; message: string }[] }> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBe(true);
  const [content] = result.content as { type: string; text: string }[];
  return JSON.parse(content?.text ?? "{}");
}

function agentScanTask() {
  const profile = seedProfile(ctx);
  const target = seedTarget(ctx, { category: "people-search" });
  ctx.services.dispatch.enqueueScan(profile.id, target.id);
  return { profile, target };
}

describe("the endpoint", () => {
  it("turns away a call without the token and a call with the wrong one", async () => {
    const bare = await fetch(url, { method: "POST" });
    expect(bare.status).toBe(401);
    await expect(connect("not-the-token")).rejects.toThrow();
  });

  it("is off until MCP is enabled", async () => {
    ctx.services.settings.set("mcp.enabled", false);
    await expect(connect()).rejects.toThrow();
    const response = await ctx.injectMcp({ method: "POST", url: "/mcp", payload: {} });
    expect(response.statusCode).toBe(503);
  });

  it("serves a client that connects, initializes, and lists the tools", async () => {
    const client = await connect();
    expect(client.getServerVersion()?.name).toBe("kick-rocks");
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.description, tool.name).toBe(
        MCP_TOOLS[tool.name as keyof typeof MCP_TOOLS].description,
      );
      expect(tool.outputSchema, tool.name).toBeDefined();
    }
  });

  it("describes defaults and enums in the tool schemas", async () => {
    const { tools } = await (await connect()).listTools();
    const claim = tools.find((tool) => tool.name === "claim_task");
    expect(claim?.inputSchema.required).toEqual(["workerId"]);
    expect(JSON.stringify(claim?.inputSchema)).toContain("agent");
  });

  it("answers GET and DELETE with 405 because it keeps no sessions", async () => {
    for (const method of ["GET", "DELETE"] as const) {
      const response = await ctx.injectMcp({ method, url: "/mcp" });
      expect(response.statusCode, method).toBe(405);
      expect(response.headers.allow).toBe("POST");
    }
  });

  it("answers a body that is not JSON in JSON-RPC", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${TEST_MCP_TOKEN}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      payload: "{ nope",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32700 } });
  });

  it("refuses a request from another origin even with the token", async () => {
    const response = await ctx.injectMcp({
      method: "POST",
      url: "/mcp",
      payload: {},
      headers: { origin: "https://evil.example.org", host: "localhost:8420" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("accepts its own origin", async () => {
    const response = await ctx.injectMcp({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "ping" },
      headers: {
        origin: "http://localhost:8420",
        host: "localhost:8420",
        accept: "application/json, text/event-stream",
      },
    });
    expect(response.statusCode).toBe(200);
  });

  it("carries the security headers of every response", async () => {
    const response = await ctx.injectMcp({ method: "GET", url: "/mcp" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("accepts a screenshot larger than the default body limit, and nothing past its own limit", async () => {
    agentScanTask();
    const client = await connect();
    const { task } = await call<{ task: { id: string } }>(client, "claim_task", { workerId: "a" });
    const big = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(2 * 1024 * 1024)]);
    const blocked = await call<{ task: { hasScreenshot: boolean } }>(client, "block_task", {
      workerId: "a",
      taskId: task.id,
      reason: "captcha",
      screenshot: { mime: "image/png", dataBase64: big.toString("base64") },
    });
    expect(blocked.task.hasScreenshot).toBe(true);

    const oversize = await ctx.injectMcp({
      method: "POST",
      url: "/mcp",
      payload: "x".repeat(SCREENSHOT_BODY_LIMIT_BYTES + 1),
      headers: { "content-type": "application/json" },
    });
    expect(oversize.statusCode).toBe(413);
  });
});

function agentPayload() {
  return {
    purpose: "scan" as const,
    profileId: "p",
    targetId: "t",
    requestId: null,
    recordUrl: null,
    variant: null,
    reason: "no_recipe" as const,
    previousError: null,
    blockedReason: null,
  };
}

describe("list_tasks", () => {
  it("shows open browser work and nothing the server does itself", async () => {
    const { target } = agentScanTask();
    seedTask(ctx, { kind: "inbox_poll", payload: { mailboxId: "m" } });
    seedTask(ctx, { kind: "agent", status: "done", payload: agentPayload() });
    const { tasks } = await call<{ tasks: { kind: string; status: string; targetId: string }[] }>(
      await connect(),
      "list_tasks",
      {},
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ kind: "agent", status: "queued", targetId: target.id });
  });

  it("keeps the person's name and city out of the address a blocked task reports", async () => {
    seedTask(ctx, {
      kind: "agent",
      status: "blocked",
      payload: agentPayload(),
      blockedUrl: "https://people.test/results?name=Jordan%20Example&city=Austin",
    });
    const { tasks } = await call<{ tasks: { blockedUrl: string | null }[] }>(
      await connect(),
      "list_tasks",
      {},
    );
    expect(tasks[0]?.blockedUrl).toBe("https://people.test");
    expect(JSON.stringify(tasks)).not.toMatch(/Jordan|Austin/);
  });

  it("filters by status and kind, and never lists in-process kinds", async () => {
    agentScanTask();
    seedTask(ctx, { kind: "agent", status: "done", payload: agentPayload() });
    const client = await connect();
    const done = await call<{ tasks: unknown[] }>(client, "list_tasks", { status: "done" });
    expect(done.tasks).toHaveLength(1);
    const forms = await call<{ tasks: unknown[] }>(client, "list_tasks", { kind: "form" });
    expect(forms.tasks).toEqual([]);
    seedTask(ctx, {
      kind: "email_send",
      payload: { requestId: "r", kind: "initial", fields: [], inReplyTo: null },
    });
    const mail = await call<{ tasks: unknown[] }>(client, "list_tasks", { kind: "email_send" });
    expect(mail.tasks).toEqual([]);
  });

  it("honours the limit and rejects one outside the range", async () => {
    agentScanTask();
    agentScanTask();
    const client = await connect();
    const limited = await call<{ tasks: unknown[] }>(client, "list_tasks", { limit: 1 });
    expect(limited.tasks).toHaveLength(1);
    const result = await client.callTool({ name: "list_tasks", arguments: { limit: 0 } });
    expect(result.isError).toBe(true);
  });

  it("carries no payload, result, or personal data", async () => {
    agentScanTask();
    const result = await (await connect()).callTool({ name: "list_tasks", arguments: {} });
    const text = JSON.stringify(result);
    expect(text).not.toContain("Jordan");
    expect(text).not.toContain("payload");
  });
});

describe("claim_task", () => {
  it("leases an agent task with its instructions and only the fields it may use", async () => {
    const { target } = agentScanTask();
    const { task } = await call<{
      task: {
        id: string;
        kind: string;
        instructions: string;
        fields: Record<string, string>;
        target: { id: string };
      };
    }>(await connect(), "claim_task", { workerId: "claude" });
    expect(task).toMatchObject({ kind: "agent", target: { id: target.id }, attempt: 1 });
    expect(task.instructions.length).toBeGreaterThan(50);
    expect(task.fields.first_name).toBe("Jordan");
    expect(Object.keys(task.fields)).not.toContain("dob");

    const row = ctx.services.taskQueue.getOrThrow(task.id);
    expect(row).toMatchObject({ status: "leased", leaseOwner: "claude", claimerKind: "mcp" });
  });

  it("answers null when nothing is waiting", async () => {
    expect(await call(await connect(), "claim_task", { workerId: "claude" })).toEqual({
      task: null,
    });
  });

  it("leaves tasks that carry a recipe to the built-in worker unless asked for them", async () => {
    const profile = seedProfile(ctx);
    const target = seedTarget(ctx, { category: "people-search" });
    seedRecipe(ctx, target.id, { purpose: "scan" });
    ctx.services.dispatch.enqueueScan(profile.id, target.id);
    const client = await connect();
    expect(await call(client, "claim_task", { workerId: "claude" })).toEqual({ task: null });
    const asked = await call<{ task: { kind: string } | null }>(client, "claim_task", {
      workerId: "claude",
      kinds: ["scan"],
    });
    expect(asked.task?.kind).toBe("scan");
  });

  it("claims one task by id, and hands a blocked one to an agent in the same call", async () => {
    agentScanTask();
    const leased = ctx.services.taskQueue.claim({
      workerId: "builtin-1",
      kinds: ["agent"],
      leaseMs: 60_000,
      claimerKind: "builtin",
    });
    const blocked = ctx.services.taskQueue.block(leased?.id as string, {
      workerId: "builtin-1",
      reason: "captcha",
      actor: "worker",
    });
    const { task } = await call<{
      task: { id: string; payload: { reason: string; blockedReason: string } };
    }>(await connect(), "claim_task", { workerId: "claude", taskId: blocked.id });
    expect(task.id).not.toBe(blocked.id);
    expect(task.payload).toMatchObject({ reason: "blocked", blockedReason: "captcha" });
    expect(ctx.services.taskQueue.getOrThrow(blocked.id).status).toBe("cancelled");
    expect(ctx.services.taskQueue.getOrThrow(task.id)).toMatchObject({ claimerKind: "mcp" });
  });

  it("reports a task that does not exist", async () => {
    const error = await callError(await connect(), "claim_task", {
      workerId: "claude",
      taskId: "nope",
    });
    expect(error.code).toBe("task_not_found");
  });

  it("validates its input with the shared schema", async () => {
    const client = await connect();
    const invalid = [
      {},
      { workerId: "" },
      { workerId: "a", leaseMs: 1 },
      { workerId: "a", kinds: [] },
      { workerId: "a", kinds: ["email_send"] },
    ];
    for (const args of invalid) {
      const result = await client.callTool({ name: "claim_task", arguments: args });
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
  });
});

describe("working a task", () => {
  async function claimed(client: Client, workerId = "claude") {
    agentScanTask();
    const { task } = await call<{ task: { id: string } }>(client, "claim_task", { workerId });
    return task.id;
  }

  it("extends the lease with heartbeat_task", async () => {
    const client = await connect();
    const id = await claimed(client);
    const before = ctx.services.taskQueue.getOrThrow(id).leaseExpiresAt as string;
    ctx.clock.advance(60_000);
    const { leaseExpiresAt } = await call<{ leaseExpiresAt: string }>(client, "heartbeat_task", {
      workerId: "claude",
      taskId: id,
    });
    expect(Date.parse(leaseExpiresAt)).toBeGreaterThan(Date.parse(before));
  });

  it("tells a late agent its lease ran out", async () => {
    const client = await connect();
    const id = await claimed(client, "slow");
    ctx.clock.advance(60 * 60 * 1000);
    const error = await callError(client, "heartbeat_task", { workerId: "slow", taskId: id });
    expect(error.code).toBe("lease_expired");
  });

  it("completes a scan with a result of the right shape and records the usage", async () => {
    const client = await connect();
    const id = await claimed(client);
    const { task } = await call<{
      task: { status: string; claimerKind: string; usage: { costUsd: number } };
    }>(client, "complete_task", {
      workerId: "claude",
      taskId: id,
      result: { purpose: "scan", scan: { candidates: [] } },
      usage: { inputTokens: 1200, outputTokens: 300, costUsd: 0.02 },
    });
    expect(task).toMatchObject({ status: "done", claimerKind: "mcp", usage: { costUsd: 0.02 } });
    expect(ctx.services.taskQueue.getOrThrow(id).result).toEqual({
      purpose: "scan",
      scan: { candidates: [] },
    });
  });

  it("explains a result of the wrong shape and keeps the lease", async () => {
    const client = await connect();
    const id = await claimed(client);
    const missing = await client.callTool({
      name: "complete_task",
      arguments: { workerId: "claude", taskId: id },
    });
    expect(missing.isError).toBe(true);
    const wrong = [
      null,
      { outcome: "submitted" },
      { purpose: "remove", form: { outcome: "submitted" } },
    ];
    for (const result of wrong) {
      const error = await callError(client, "complete_task", {
        workerId: "claude",
        taskId: id,
        result,
      });
      expect(error.code).toBe("invalid_result");
    }
    expect(ctx.services.taskQueue.getOrThrow(id).status).toBe("leased");
  });

  it("refuses an agent that does not hold the lease", async () => {
    const client = await connect();
    const id = await claimed(client);
    const error = await callError(client, "complete_task", {
      workerId: "someone-else",
      taskId: id,
      result: { purpose: "scan", scan: { candidates: [] } },
    });
    expect(error.code).toBe("lease_not_held");
    expect(ctx.services.taskQueue.getOrThrow(id).status).toBe("leased");
  });

  it("parks a task for a human with the page and a screenshot", async () => {
    const client = await connect();
    const id = await claimed(client);
    const { task } = await call<{
      task: { status: string; blockedReason: string; blockedUrl: string; hasScreenshot: boolean };
    }>(client, "block_task", {
      workerId: "claude",
      taskId: id,
      reason: "captcha",
      detail: "A CAPTCHA before the form",
      url: "https://example.test/optout",
      screenshot: { mime: "image/png", dataBase64: PNG.toString("base64") },
    });
    expect(task).toMatchObject({
      status: "blocked",
      blockedReason: "captcha",
      blockedUrl: "https://example.test/optout",
      hasScreenshot: true,
    });
    expect(ctx.services.taskQueue.screenshot(id)?.data.equals(PNG)).toBe(true);
  });

  it("rejects a screenshot that is not what it says, without parking the task", async () => {
    const client = await connect();
    const id = await claimed(client);
    const bad = [
      { mime: "image/png", dataBase64: "not base64 at all!" },
      { mime: "image/png", dataBase64: Buffer.from("<html>").toString("base64") },
      { mime: "image/jpeg", dataBase64: PNG.toString("base64") },
      { mime: "image/gif", dataBase64: PNG.toString("base64") },
    ];
    for (const screenshot of bad) {
      const result = await client.callTool({
        name: "block_task",
        arguments: { workerId: "claude", taskId: id, reason: "captcha", screenshot },
      });
      expect(result.isError, JSON.stringify(screenshot)).toBe(true);
    }
    expect(ctx.services.taskQueue.getOrThrow(id).status).toBe("leased");
  });

  it("reports a failure and lets a retryable one go back in the queue", async () => {
    const client = await connect();
    const id = await claimed(client);
    const { task } = await call<{
      task: { status: string; failureKind: string; lastError: string };
    }>(client, "fail_task", {
      workerId: "claude",
      taskId: id,
      error: "The site timed out",
      retryable: true,
      kind: "site",
    });
    expect(task).toMatchObject({
      status: "queued",
      failureKind: "site",
      lastError: "The site timed out",
    });
  });

  it("fails for good when the failure is not retryable", async () => {
    const client = await connect();
    const id = await claimed(client);
    const { task } = await call<{ task: { status: string } }>(client, "fail_task", {
      workerId: "claude",
      taskId: id,
      error: "The broker removed its form",
      retryable: false,
    });
    expect(task.status).toBe("failed");
  });

  it("does not let an agent blame a recipe it never ran", async () => {
    const client = await connect();
    const id = await claimed(client);
    const error = await callError(client, "fail_task", {
      workerId: "claude",
      taskId: id,
      error: "x",
      retryable: false,
      kind: "recipe",
    });
    expect(error.code).toBe("invalid_request");
    expect(ctx.services.taskQueue.getOrThrow(id).status).toBe("leased");
  });

  it("hands a task back without costing an attempt", async () => {
    const client = await connect();
    const id = await claimed(client);
    const { task } = await call<{ task: { status: string; attempts: number } }>(
      client,
      "release_task",
      { workerId: "claude", taskId: id, retryAfterMs: 60_000 },
    );
    expect(task).toMatchObject({ status: "queued", attempts: 0 });
    expect(await call(client, "claim_task", { workerId: "claude" })).toEqual({ task: null });
    ctx.clock.advance(61_000);
    const again = await call<{ task: { id: string } | null }>(client, "claim_task", {
      workerId: "claude",
    });
    expect(again.task?.id).toBe(id);
  });

  it("cannot report on a task the built-in worker holds, even under its worker id", async () => {
    const profile = seedProfile(ctx);
    const target = seedTarget(ctx, { category: "people-search" });
    seedRecipe(ctx, target.id, { purpose: "scan" });
    ctx.services.dispatch.enqueueScan(profile.id, target.id);
    const response = await ctx.injectWorker({
      method: "POST",
      url: "/api/worker/claim",
      payload: { workerId: "builtin-1" },
    });
    const taskId = response.json().task.id as string;

    const client = await connect();
    const attempts = [
      ["heartbeat_task", {}],
      ["release_task", {}],
      ["block_task", { reason: "captcha" }],
      ["fail_task", { error: "x", retryable: false }],
      ["complete_task", { result: { candidates: [] } }],
    ] as const;
    for (const [name, extra] of attempts) {
      const error = await callError(client, name, { workerId: "builtin-1", taskId, ...extra });
      expect(error.code, name).toBe("lease_not_held");
    }
    expect(ctx.services.taskQueue.getOrThrow(taskId)).toMatchObject({
      status: "leased",
      leaseOwner: "builtin-1",
    });
  });
});

describe("get_target and get_recipe", () => {
  it("describes a target with the recipes that exist for it", async () => {
    const target = seedTarget(ctx, { category: "people-search", notes: "Needs the record URL" });
    seedRecipe(ctx, target.id, { purpose: "scan", health: "healthy" });
    seedRecipe(ctx, target.id, { purpose: "remove", status: "pending_review", source: "proposed" });
    const detail = await call<{
      id: string;
      notes: string;
      needsRecord: boolean;
      recipes: { purpose: string; status: string; health: string }[];
    }>(await connect(), "get_target", { targetId: target.id });
    expect(detail).toMatchObject({
      id: target.id,
      notes: "Needs the record URL",
      needsRecord: true,
    });
    expect(detail.recipes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ purpose: "scan", status: "active", health: "healthy" }),
        expect.objectContaining({ purpose: "remove", status: "pending_review" }),
      ]),
    );
  });

  it("describes a company with its verification date", async () => {
    const company = seedTarget(ctx, { kind: "company", verifiedAt: "2026-09-01" });
    const detail = await call<{ kind: string; verifiedAt: string }>(await connect(), "get_target", {
      targetId: company.id,
    });
    expect(detail).toMatchObject({ kind: "company", verifiedAt: "2026-09-01" });
  });

  it("says when a target is unknown", async () => {
    const client = await connect();
    expect((await callError(client, "get_target", { targetId: "nope" })).code).toBe(
      "target_not_found",
    );
    expect((await callError(client, "get_recipe", { targetId: "nope" })).code).toBe(
      "target_not_found",
    );
  });

  it("returns the stored recipes with their definitions, optionally for one purpose", async () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { purpose: "scan" });
    seedRecipe(ctx, target.id, { purpose: "remove" });
    const client = await connect();
    const all = await call<{ recipes: { purpose: string; definition: { steps: unknown[] } }[] }>(
      client,
      "get_recipe",
      { targetId: target.id },
    );
    expect(all.recipes).toHaveLength(2);
    expect(all.recipes[0]?.definition.steps.length).toBeGreaterThan(0);
    const scans = await call<{ recipes: { purpose: string }[] }>(client, "get_recipe", {
      targetId: target.id,
      purpose: "scan",
    });
    expect(scans.recipes.map((recipe) => recipe.purpose)).toEqual(["scan"]);
  });
});

describe("propose_recipe", () => {
  const recipeCount = () => ctx.services.db.select().from(recipes).all().length;

  it("holds a proposal for review and never makes it active", async () => {
    const target = seedTarget(ctx);
    const { recipe: stored } = await call<{
      recipe: { id: string; status: string; source: string; health: string };
    }>(await connect(), "propose_recipe", {
      recipe: makeRecipe({ brokerId: target.id }),
      notes: "The form moved to /privacy/optout",
    });
    expect(stored).toMatchObject({
      id: `${target.id}.remove.v1`,
      status: "pending_review",
      source: "proposed",
      health: "unknown",
    });
    const listed = await ctx.call(API_ROUTES.recipesList, { query: { status: "pending_review" } });
    expect(listed.ok && listed.body.recipes.map((r) => r.notes)).toEqual([
      "The form moved to /privacy/optout",
    ]);
  });

  it("numbers the proposal after the recipes that exist, whatever version it carries", async () => {
    const target = seedTarget(ctx);
    seedRecipe(ctx, target.id, { version: 3 });
    const { recipe } = await call<{
      recipe: { id: string; version: number; definition: { id: string; version: number } };
    }>(await connect(), "propose_recipe", {
      recipe: makeRecipe({
        brokerId: target.id,
        version: 1,
        definition: {
          notes: "different steps",
          steps: [
            { kind: "goto", url: `https://${target.id}.test/optout` },
            { kind: "click", target: { role: "button", label: "Remove" } },
          ],
        },
      }),
    });
    expect(recipe).toMatchObject({ id: `${target.id}.remove.v4`, version: 4 });
    expect(recipe.definition).toMatchObject({ id: `${target.id}.remove.v4`, version: 4 });
  });

  it("does not take the author's word that it was verified", async () => {
    const target = seedTarget(ctx);
    const recipe = makeRecipe({
      brokerId: target.id,
      definition: { liveStatus: "verified", verifiedAt: "2026-10-01" },
    });
    const { recipe: stored } = await call<{
      recipe: { definition: { liveStatus: string; verifiedAt: string | null } };
    }>(await connect(), "propose_recipe", { recipe });
    expect(stored.definition).toMatchObject({ liveStatus: "unverified", verifiedAt: null });
  });

  it("answers a repeated proposal with the one already waiting", async () => {
    const target = seedTarget(ctx);
    const client = await connect();
    const recipe = makeRecipe({ brokerId: target.id });
    const first = await call<{ recipe: { id: string } }>(client, "propose_recipe", {
      recipe,
      notes: "one",
    });
    const second = await call<{ recipe: { id: string } }>(client, "propose_recipe", {
      recipe,
      notes: "two",
    });
    expect(second.recipe.id).toBe(first.recipe.id);
    expect(recipeCount()).toBe(1);
  });

  it("refuses a proposal identical to a recipe that already works", async () => {
    const target = seedTarget(ctx);
    const existing = seedRecipe(ctx, target.id);
    const error = await callError(await connect(), "propose_recipe", {
      recipe: makeRecipe({ brokerId: target.id, version: existing.version + 1 }),
    });
    expect(error.code).toBe("recipe_unchanged");
  });

  it("refuses a recipe for a broker that does not exist or no longer does", async () => {
    const client = await connect();
    const ghost = await callError(client, "propose_recipe", {
      recipe: makeRecipe({ brokerId: "ghost" }),
    });
    expect(ghost.code).toBe("target_not_found");
    const retired = seedTarget(ctx);
    ctx.services.db.update(targets).set({ retired: true }).where(eq(targets.id, retired.id)).run();
    const gone = await callError(client, "propose_recipe", {
      recipe: makeRecipe({ brokerId: retired.id }),
    });
    expect(gone.code).toBe("target_retired");
  });

  it("refuses a recipe that sends the person's details to another site", async () => {
    const target = seedTarget(ctx);
    const recipe = makeRecipe({
      brokerId: target.id,
      definition: {
        entryUrl: "https://collector.example.org/optout",
        steps: [
          { kind: "goto", url: "https://collector.example.org/optout" },
          { kind: "fill", target: { label: "Email" }, field: "email" },
          { kind: "click", target: { role: "button", label: "Remove" } },
        ],
        canary: {
          url: "https://collector.example.org/optout",
          selectors: [{ label: "Email" }],
          steps: [],
        },
      },
    });
    const error = await callError(await connect(), "propose_recipe", { recipe });
    expect(error.code).toBe("invalid_recipe");
    expect(error.issues?.map((issue) => issue.message).join(" ")).toContain(
      "collector.example.org",
    );
    expect(recipeCount()).toBe(0);
  });

  it("rejects a recipe that does not match the schema", async () => {
    const target = seedTarget(ctx);
    const recipe = {
      ...makeRecipe({ brokerId: target.id }),
      steps: [{ kind: "goto", url: "javascript:alert(1)" }],
    };
    const result = await (await connect()).callTool({
      name: "propose_recipe",
      arguments: { recipe },
    });
    expect(result.isError).toBe(true);
    expect(recipeCount()).toBe(0);
  });

  it("limits how many proposals can wait for one broker", async () => {
    const target = seedTarget(ctx);
    const client = await connect();
    const variant = (pause: number) =>
      makeRecipe({
        brokerId: target.id,
        definition: {
          steps: [
            { kind: "goto", url: `https://${target.id}.test/optout` },
            { kind: "pause", minMs: pause, maxMs: pause + 1 },
            { kind: "click", target: { role: "button", label: "Remove" } },
          ],
        },
      });
    for (let pause = 0; pause < 5; pause++) {
      await call(client, "propose_recipe", { recipe: variant(pause) });
    }
    const error = await callError(client, "propose_recipe", { recipe: variant(99) });
    expect(error.code).toBe("too_many_proposals");
  });
});
