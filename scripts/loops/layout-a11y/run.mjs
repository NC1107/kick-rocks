#!/usr/bin/env node
// Layout, accessibility and delivery gate. Prints one JSON result; score is the number of failing
// items, so lower is better and zero means the target is met.
//
// Flags: --skip-build reuses apps/web/dist, --no-lighthouse skips the delivery run,
// --lh-runs=N Lighthouse runs per route, worst one counts (default 2), --shots=DIR writes screenshots of every
// route in both themes at each width for a visual review.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { failingContrastPairsOf } from "./contrast.mjs";
import { inspectPage } from "./inspect-page.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const webDir = join(root, "apps/web");
const dist = join(webDir, "dist");
const requireFromServer = createRequire(join(root, "apps/server/package.json"));
const requireFromRoot = createRequire(join(root, "package.json"));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const WIDTHS = [390, 768, 1280];
const THEMES = ["light", "dark"];
const AUTHED_ROUTES = [
  "/",
  "/profiles",
  "/profiles/new",
  "/profiles/prf_0001",
  "/profiles/prf_0001/mailbox",
  "/profiles/prf_0002/mailbox",
  "/targets",
  "/targets/clearcheck",
  "/targets/harbor-consumer-data",
  "/campaigns/new",
  "/requests",
  "/requests/req_0017",
  "/review",
  "/settings",
  "/settings/recipes",
  "/settings/agents",
  "/settings/notifications",
  "/about",
  "/nope-404",
];
const PUBLIC_ROUTES = [
  { route: "/login", mode: "login" },
  { route: "/setup", mode: "setup" },
];
const LIGHTHOUSE_ROUTES = ["/", "/requests", "/review", "/targets"];
const TAP_TARGET_MIN = 44;
const TOUCH_WIDTHS = [390, 768];
const CLS_BUDGET = 0.01;
const LIGHTHOUSE_TARGET = 90;
const TRANSFER_BUDGET_BYTES = 350 * 1024;
const LATE_ASSET_DELAY_MS = 400;

const children = [];
function stopAll() {
  for (const child of children) child.kill("SIGTERM");
}
process.on("exit", stopAll);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

async function startMockApi() {
  const port = await freePort();
  const child = spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "--mode",
      "mock",
      "--port",
      String(port),
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    {
      cwd: webDir,
      env: { ...process.env, KICKROCKS_MOCK_LATENCY: "20" },
      stdio: "ignore",
    },
  );
  children.push(child);
  await waitFor(`http://127.0.0.1:${port}/__mock/auth?mode=authed`);
  return port;
}

// The real Fastify static options and fallback, so headers and compression are what a self-hoster
// gets; only /api and /__mock go to the mock.
async function startProductionHost(apiPort) {
  const { default: Fastify } = await import(requireFromServer.resolve("fastify"));
  const fastifyStatic = (await import(requireFromServer.resolve("@fastify/static"))).default;
  const { webAssetOptions } = await import(join(root, "apps/server/src/web-assets.ts"));
  const server = Fastify({ logger: false });
  await server.register(fastifyStatic, webAssetOptions(dist));
  const forward = (request, reply) => {
    reply.hijack();
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: apiPort,
        path: request.raw.url,
        method: request.method,
        headers: request.headers,
      },
      (response) => {
        reply.raw.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(reply.raw);
      },
    );
    upstream.on("error", () => {
      reply.raw.writeHead(502);
      reply.raw.end();
    });
    request.raw.pipe(upstream);
  };
  server.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/") || request.url.startsWith("/__mock/")) {
      return forward(request, reply);
    }
    return reply.sendFile("index.html");
  });
  await server.listen({ port: 0, host: "127.0.0.1" });
  return { port: server.server.address().port, close: () => server.close() };
}

async function measureSweep(browser, base, axeSource, shotsDir) {
  const findings = { axe: new Map(), overflow: new Map(), ellipsis: new Map(), tap: new Map() };
  const consoleIssues = [];
  const note = (bucket, key, where) => {
    const set = findings[bucket].get(key) ?? new Set();
    set.add(where);
    findings[bucket].set(key, set);
  };

  async function visit({ route, mode }, theme, width) {
    const context = await browser.newContext({
      viewport: { width, height: width > 600 ? 900 : 844 },
      colorScheme: theme,
      hasTouch: TOUCH_WIDTHS.includes(width),
    });
    await context.addInitScript((t) => {
      try {
        localStorage.setItem("kickrocks.theme", t);
      } catch {}
    }, theme);
    const page = await context.newPage();
    page.on("console", (m) => {
      if (
        ["error", "warning"].includes(m.type()) &&
        !/ERR_NETWORK_CHANGED|ERR_ABORTED/.test(m.text())
      )
        consoleIssues.push(`${route} ${m.text().slice(0, 120)}`);
    });
    await page.goto(`${base}/__mock/auth?mode=${mode}`);
    await page.goto(base + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.addScriptTag({ content: axeSource });
    const axeResult = await page.evaluate(() =>
      axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
        },
      }),
    );
    const where = `${theme}${width}`;
    for (const v of axeResult.violations) {
      for (const n of v.nodes) note("axe", `${v.id} ${route} ${n.target.join(" ")}`, where);
    }
    const inspected = await page.evaluate(inspectPage, {
      minTarget: TAP_TARGET_MIN,
      checkTargets: TOUCH_WIDTHS.includes(width),
    });
    for (const text of inspected.overflow) note("overflow", text, `${route}@${where}`);
    for (const text of inspected.ellipsised) note("ellipsis", `${route} ${text}`, where);
    for (const text of inspected.small) note("tap", text, `${route}@${where}`);
    if (shotsDir) {
      const name = `${route === "/" ? "home" : route.slice(1).replace(/\//g, "_")}-${theme}-${width}.png`;
      await page.screenshot({ path: join(shotsDir, name), fullPage: true });
    }
    await context.close();
  }

  // The mock keeps one session state, so signed-out pages run alone after the signed-in ones.
  const queue = [];
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      for (const route of AUTHED_ROUTES) queue.push([{ route, mode: "authed" }, theme, width]);
    }
  }
  const workers = Array.from({ length: 4 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await visit(...job);
  });
  await Promise.all(workers);
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      for (const entry of PUBLIC_ROUTES) await visit(entry, theme, width);
    }
  }
  await fetchOk(`${base}/__mock/auth?mode=authed`);
  return { findings, consoleIssues };
}

async function fetchOk(url) {
  await fetch(url);
}

// Fonts and images arrive late on a slow link, which is when a page with no reserved space jumps.
async function renderedPlexFace(context, page) {
  const session = await context.newCDPSession(page);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  const { root } = await session.send("DOM.getDocument");
  const { nodeId } = await session.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "h1",
  });
  if (!nodeId) return false;
  const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId });
  return fonts.some((font) => font.familyName.startsWith("IBM Plex"));
}

async function measureLayoutShift(browser, base) {
  const failing = new Map();
  const routes = [
    "/",
    "/profiles",
    "/targets",
    "/requests",
    "/requests/req_0017",
    "/review",
    "/settings",
    "/about",
  ];
  for (const width of [390, 768, 1280]) {
    for (const route of routes) {
      const context = await browser.newContext({
        viewport: { width, height: width > 600 ? 900 : 844 },
        hasTouch: TOUCH_WIDTHS.includes(width),
      });
      await context.route(
        /\.(woff2|png|jpg|webp|svg)(\?|$)|\/api\/.*(screenshot|image)/,
        async (r) => {
          await new Promise((done) => setTimeout(done, LATE_ASSET_DELAY_MS));
          await r.continue();
        },
      );
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__cls = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(`${base}/__mock/auth?mode=authed`);
      await page.goto(base + route, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const cls = await page.evaluate(() => window.__cls);
      if (cls > CLS_BUDGET) failing.set(`${route} @${width}`, Number(cls.toFixed(3)));
      // A page that never paints the brand font has no font swap to shift, so that cannot pass.
      const rendered = await renderedPlexFace(context, page);
      if (!rendered) failing.set(`${route} @${width} never rendered IBM Plex`, 0);
      await context.close();
    }
  }
  return failing;
}

async function measureLighthouse(base, runs) {
  const lighthouse = (await import(requireFromRoot.resolve("lighthouse"))).default;
  const chromeLauncher = await import(requireFromRoot.resolve("chrome-launcher"));
  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox"],
    chromePath: "/usr/bin/google-chrome",
  });
  const results = [];
  try {
    await fetch(`${base}/__mock/auth?mode=authed`);
    for (const route of LIGHTHOUSE_ROUTES) {
      const scores = [];
      let bytes = 0;
      for (let i = 0; i < runs; i++) {
        const run = await lighthouse(base + route, {
          port: chrome.port,
          onlyCategories: ["performance"],
          output: "json",
          logLevel: "error",
        });
        scores.push(Math.round((run?.lhr.categories.performance.score ?? 0) * 100));
        bytes = run?.lhr.audits["total-byte-weight"].numericValue ?? 0;
      }
      results.push({ route, score: Math.min(...scores), scores, bytes: Math.round(bytes) });
    }
  } finally {
    await chrome.kill();
  }
  return results;
}

function summarize(map, limit = 6) {
  return [...map.entries()].map(([key, where]) => {
    const list = [...where].sort();
    const shown = list.slice(0, limit).join(",");
    return `${key} [${shown}${list.length > limit ? ` +${list.length - limit} more` : ""}]`;
  });
}

async function main() {
  const failing = [];
  const metrics = {};

  const contrast = failingContrastPairsOf(join(webDir, "src/index.css"));
  metrics.contrastPairs = contrast.length;
  for (const pair of contrast) failing.push(`contrast-token ${pair}`);

  if (!flag("skip-build")) {
    const build = spawnSync("pnpm", ["--filter", "@kickrocks/web", "build"], {
      cwd: root,
      stdio: "ignore",
    });
    if (build.status !== 0) throw new Error("web build failed");
  }
  const apiPort = await startMockApi();
  const host = await startProductionHost(apiPort);
  const base = `http://127.0.0.1:${host.port}`;

  const playwright = await import(requireFromRoot.resolve("playwright-core"));
  const chromium = playwright.chromium ?? playwright.default.chromium;
  const axeSource = readFileSync(requireFromRoot.resolve("axe-core/axe.min.js"), "utf8");
  const shotsDir = option("shots");
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  try {
    const { findings, consoleIssues } = await measureSweep(browser, base, axeSource, shotsDir);
    metrics.axeNodes = findings.axe.size;
    metrics.axeRules = new Set([...findings.axe.keys()].map((k) => k.split(" ")[0])).size;
    metrics.overflowElements = findings.overflow.size;
    metrics.ellipsisedSentences = findings.ellipsis.size;
    metrics.smallTapTargets = findings.tap.size;
    metrics.consoleIssues = consoleIssues.length;
    for (const line of summarize(findings.axe)) failing.push(`axe ${line}`);
    for (const line of summarize(findings.overflow)) failing.push(`overflow ${line}`);
    for (const line of summarize(findings.ellipsis)) failing.push(`ellipsis ${line}`);
    for (const line of summarize(findings.tap)) failing.push(`tap-target ${line}`);
    for (const line of new Set(consoleIssues)) failing.push(`console ${line}`);

    const shifts = await measureLayoutShift(browser, base);
    metrics.clsRoutesOverBudget = shifts.size;
    for (const [where, value] of shifts) failing.push(`cls ${where} ${value}`);
  } finally {
    await browser.close();
  }

  if (!flag("no-lighthouse")) {
    const runs = Number(option("lh-runs") ?? 2);
    const lighthouseRuns = await measureLighthouse(base, runs);
    metrics.lighthouse = lighthouseRuns;
    for (const r of lighthouseRuns) {
      if (r.score < LIGHTHOUSE_TARGET)
        failing.push(`lighthouse-mobile ${r.route} ${r.score} < ${LIGHTHOUSE_TARGET}`);
      if (r.bytes > TRANSFER_BUDGET_BYTES) {
        failing.push(
          `transfer ${r.route} ${Math.round(r.bytes / 1024)} KB > ${TRANSFER_BUDGET_BYTES / 1024} KB`,
        );
      }
    }
  }
  await host.close();

  const result = { score: failing.length, targetMet: failing.length === 0, metrics, failing };
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
