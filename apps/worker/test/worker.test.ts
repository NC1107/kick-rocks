import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaimedTask } from "@kickrocks/shared";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { loadWorkerConfig } from "../src/config.js";
import { runWorker } from "../src/worker.js";
import { describeBrowser, recipeFor, silentLogger, summary, task } from "./support.js";

interface Report {
  action: string;
  taskId: string;
  body: Record<string, unknown>;
}

const FORM = `<!doctype html><title>Opt out</title><h1>Opt out</h1>
<form method="post" action="/submit">
<label for="e">Email</label><input id="e" name="email" type="email">
<button type="submit">Submit request</button></form>`;
const CAPTCHA = `<!doctype html><title>Opt out</title><h1>Opt out</h1>
<form method="post" action="/submit">
<label for="e">Email</label><input id="e" name="email" type="email">
<div class="g-recaptcha"><iframe title="reCAPTCHA" width="304" height="78"
 src="/widget/recaptcha/api2/anchor?size=normal"></iframe></div>
<button type="submit">Submit request</button></form>`;

let site: Server;
let siteOrigin: string;
let submissions: string[];

let api: Server;
let apiUrl: string;
let queue: ClaimedTask[];
let reports: Report[];
let heartbeats: number;

let profileDir: string;
let controller: AbortController;

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

beforeAll(async () => {
  site = createServer(async (request, response) => {
    const path = request.url ?? "/";
    if (request.method === "POST") {
      submissions.push(await body(request));
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>Done</title><p>Request received</p>");
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    if (path.startsWith("/confirm")) response.end("<!doctype html><h1>Opt-out confirmed</h1>");
    else if (path.startsWith("/widget")) response.end("<!doctype html><p>I am not a robot</p>");
    else if (path.startsWith("/captcha")) response.end(CAPTCHA);
    else response.end(FORM);
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  siteOrigin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  api = createServer(async (request, response) => {
    const url = request.url ?? "";
    const payload = JSON.parse((await body(request)) || "{}") as Record<string, unknown>;
    const send = (data: unknown) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(data));
    };
    if (url.endsWith("/worker/heartbeat")) {
      heartbeats += 1;
      return send({ ok: true, serverTime: "2026-10-07T00:00:00.000Z" });
    }
    if (url.endsWith("/worker/claim")) return send({ task: queue.shift() ?? null });
    const match = /\/worker\/tasks\/([^/]+)\/(\w+)$/.exec(url);
    if (match?.[2] === "heartbeat") return send({ leaseExpiresAt: "2026-10-07T00:05:00.000Z" });
    if (match) {
      reports.push({ action: match[2] as string, taskId: match[1] as string, body: payload });
      return send({ task: summary(match[1] as string) });
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const server of [site, api]) {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
});

beforeEach(() => {
  submissions = [];
  queue = [];
  reports = [];
  heartbeats = 0;
  profileDir = mkdtempSync(join(tmpdir(), "kickrocks-worker-profile-"));
  controller = new AbortController();
});

afterEach(() => {
  controller.abort();
  rmSync(profileDir, { recursive: true, force: true });
});

function start(): Promise<void> {
  const config = loadWorkerConfig({
    KICKROCKS_SERVER_URL: apiUrl,
    KICKROCKS_WORKER_TOKEN: "a-token-of-sixteen-chars",
    KICKROCKS_WORKER_ID: "test-worker",
    KICKROCKS_WORKER_POLL_MS: "500",
    KICKROCKS_CHROME_PROFILE: profileDir,
    KICKROCKS_WORKER_HEADLESS: "true",
    KICKROCKS_WORKER_ALLOW_HTTP: "true",
    KICKROCKS_WORKER_PACE: "instant",
  });
  return runWorker({ config, signal: controller.signal, logger: silentLogger });
}

async function reported(count: number): Promise<void> {
  await expect
    .poll(() => reports.length, { timeout: 25_000, interval: 100 })
    .toBeGreaterThanOrEqual(count);
}

const form = (path: string, fields = { email: "jordan@example.com" }) =>
  task(
    "form",
    { requestId: "r1", targetId: "fixture", recipeId: "fixture.remove.v1", recordUrl: null },
    {
      recipe: recipeFor(siteOrigin, "remove", { entryUrl: `${siteOrigin}${path}` }),
      fields,
    },
  );

describeBrowser("the worker against a fake server and a fixture site", () => {
  it("claims a form task, drives the site in Chrome, and posts the outcome with usage", async () => {
    const claimed = form("/form");
    queue.push(claimed);
    const running = start();
    await reported(1);
    controller.abort();
    await running;

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      action: "complete",
      taskId: claimed.id,
      body: {
        workerId: "test-worker",
        result: { outcome: "submitted" },
        usage: { durationMs: expect.any(Number) },
      },
    });
    expect(submissions).toEqual(["email=jordan%40example.com"]);
    expect(heartbeats).toBeGreaterThan(0);
  });

  it("parks a task behind a CAPTCHA with a screenshot and the page, and submits nothing", async () => {
    const claimed = form("/captcha");
    queue.push(claimed);
    const running = start();
    await reported(1);
    controller.abort();
    await running;

    expect(reports[0]).toMatchObject({
      action: "block",
      taskId: claimed.id,
      body: {
        reason: "captcha",
        url: `${siteOrigin}/captcha`,
        screenshot: { mime: "image/png", dataBase64: expect.stringMatching(/^iVBORw0KGgo/) },
      },
    });
    expect(submissions).toEqual([]);
  });

  it("reports a recipe that no longer matches the page as a recipe failure that is not retryable", async () => {
    const broken = task(
      "form",
      { requestId: "r1", targetId: "fixture", recipeId: "fixture.remove.v1", recordUrl: null },
      {
        recipe: recipeFor(siteOrigin, "remove", {
          steps: [{ kind: "click", target: { role: "button", label: "Delete everything" } }],
        }),
        fields: { email: "jordan@example.com" },
      },
    );
    queue.push(broken);
    const running = start();
    await reported(1);
    controller.abort();
    await running;
    expect(reports[0]).toMatchObject({
      action: "fail",
      body: { kind: "recipe", retryable: false, step: 0 },
    });
  });

  it("works through a scan, a canary, and an emailed confirmation link in order", async () => {
    const scan = task(
      "scan",
      { profileId: "p1", targetId: "fixture", recipeId: "fixture.scan.v1", variant: null },
      {
        recipe: recipeFor(siteOrigin, "scan", {
          steps: [
            {
              kind: "extract_candidates",
              item: { css: "body" },
              fields: { recordUrl: { css: "form", attr: "action" }, name: { css: "h1" } },
            },
          ],
        }),
        fields: { first_name: "Jordan" },
      },
    );
    const canary = task(
      "canary",
      { recipeId: "fixture.remove.v1" },
      { recipe: recipeFor(siteOrigin, "remove") },
    );
    const confirm = task("confirm", {
      requestId: "r1",
      url: `${siteOrigin}/confirm?token=abc123`,
    });
    queue.push(scan, canary, confirm);
    const running = start();
    await reported(3);
    controller.abort();
    await running;

    expect(reports.map((r) => [r.action, r.taskId])).toEqual([
      ["complete", scan.id],
      ["complete", canary.id],
      ["complete", confirm.id],
    ]);
    expect(reports[0]?.body.result).toEqual({
      candidates: [{ recordUrl: `${siteOrigin}/submit`, name: "Opt out", locations: [] }],
    });
    expect(reports[1]?.body.result).toEqual({ healthy: true, missingSelectors: [] });
    expect(reports[2]?.body.result).toEqual({
      confirmed: true,
      finalUrl: `${siteOrigin}/confirm`,
    });
  });

  it("stops promptly and closes the browser when asked to shut down while idle", async () => {
    const running = start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const started = Date.now();
    controller.abort();
    await running;
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
