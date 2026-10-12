#!/usr/bin/env node
// Copy-budget gate. Starts the mock web app, visits every route and the main states at phone
// size, and prints one JSON result. Score is budget violations plus a tenth of every visible
// word over the screen limit, so lower is better and zero means the copy fits.
//
// Flags: --shots=DIR writes a screenshot per screen, --only=TEXT keeps screens whose name
// contains TEXT, --top=N lists the N costliest screens (default 15).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessScreen, scoreOf } from "./budget.mjs";
import { collectScreen } from "./collect.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const requireFromRoot = createRequire(join(root, "package.json"));
const option = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const shotsDir = option("shots") ?? join(tmpdir(), "kickrocks-copy-shots");
const only = option("only");
const top = Number(option("top") ?? 15);
const VIEWPORT = { width: 390, height: 844 };
const CHROME_PATHS = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
const MAX_DIALOG_OPENERS_PER_ROUTE = 14;

const ROUTES = [
  "/",
  "/settings/profiles",
  "/profiles/new",
  "/profiles/prf_0001",
  "/profiles/prf_0001/mailbox",
  "/profiles/prf_0002/mailbox",
  "/targets",
  "/targets/listings",
  "/targets/clearcheck",
  "/targets/harbor-consumer-data",
  "/targets/harbor-consumer-data/remove",
  "/campaigns/new",
  "/requests",
  "/review",
  "/review/mail",
  "/review/agents",
  "/review/problems",
  "/settings/recipes",
  "/settings/agents",
  "/settings/notifications",
  "/settings/about",
  "/nope-404",
];
const SETTINGS_SECTIONS = [
  "schedule",
  "site-checks",
  "scan-pace",
  "sites",
  "worker",
  "reply-model",
  "language-model",
  "mail-intake",
  "jurisdictions",
  "retention",
  "password",
  "reset",
];
const DIALOG_ROUTES = [
  "/",
  "/review",
  "/requests/req_0017",
  "/requests/req_0021",
  "/profiles/prf_0001",
  "/profiles/prf_0001/mailbox",
  "/targets/harbor-consumer-data",
  "/settings",
  "/settings/profiles",
  "/settings/agents",
  "/settings/recipes",
  "/settings/notifications",
];
const NAV_LABELS = /^(menu|open menu|close menu|toggle theme|theme|skip to content)/i;

const children = [];
function stopAll() {
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
}
process.on("exit", stopAll);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

const freePort = () =>
  new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

async function startMockApp() {
  const port = await freePort();
  const child = spawn(
    "nice",
    [
      "-n",
      "19",
      "pnpm",
      "--filter",
      "@kickrocks/web",
      "dev:mock",
      "--port",
      String(port),
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    {
      cwd: root,
      env: { ...process.env, KICKROCKS_MOCK_LATENCY: "20" },
      stdio: "ignore",
      detached: true,
    },
  );
  children.push(child);
  await waitFor(`http://127.0.0.1:${port}/__mock/auth?mode=authed`);
  return `http://127.0.0.1:${port}`;
}

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "root";

async function main() {
  const playwright = requireFromRoot("playwright-core");
  const executablePath = CHROME_PATHS.find((p) => existsSync(p));
  const base = await startMockApp();
  const browser = await playwright.chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    hasTouch: true,
    colorScheme: "light",
  });
  const page = await context.newPage();
  const screens = [];
  mkdirSync(shotsDir, { recursive: true });

  async function settle() {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(350);
  }

  async function measure(name, scope = {}) {
    if (only && !name.includes(only)) return;
    const raw = await page.evaluate(collectScreen, scope);
    const assessed = assessScreen(raw);
    await page.screenshot({ path: join(shotsDir, `${slug(name)}.png`) });
    screens.push({ name, url: page.url().replace(base, ""), ...assessed });
  }

  async function visit(name, route, scope = {}) {
    await page.goto(base + route);
    await settle();
    await measure(name, scope);
  }

  const api = (path) => page.evaluate(async (p) => (await fetch(`/api${p}`)).json(), path);

  await page.goto(`${base}/__mock/auth?mode=login`);
  await visit("public /login", "/login");
  await page.goto(`${base}/__mock/auth?mode=setup`);
  await visit("public /setup", "/setup");
  await page.goto(`${base}/__mock/auth?mode=authed`);

  for (const route of ROUTES) await visit(`route ${route}`, route);
  await visit("route /settings top", "/settings", { viewportOnly: true });

  const needsYou = await api("/needs-you");
  const seenKinds = new Set();
  for (const item of needsYou.items) {
    const kind = item.kind === "task" ? `${item.kind}:${item.source?.task?.task?.kind}` : item.kind;
    if (seenKinds.has(kind)) continue;
    seenKinds.add(kind);
    await visit(
      `needs-you ${item.kind} ${item.key}`,
      `/review?item=${encodeURIComponent(item.key)}`,
    );
  }

  const requests = await api("/requests?limit=200");
  const seenStatus = new Set();
  for (const request of requests.items) {
    if (seenStatus.has(request.status)) continue;
    seenStatus.add(request.status);
    await visit(`request ${request.status} ${request.id}`, `/requests/${request.id}`);
    await visit(`requests list ${request.status}`, `/requests?status=${request.status}`);
  }

  for (const section of SETTINGS_SECTIONS) {
    await page.goto(`${base}/settings`);
    await settle();
    await page.evaluate((id) => document.getElementById(id)?.scrollIntoView(), section);
    await page.waitForTimeout(150);
    await measure(`settings section ${section}`, { id: section });
  }

  const openedDialogs = new Set();
  for (const route of DIALOG_ROUTES) {
    await page.goto(base + route);
    await settle();
    const count = await page.locator("button:visible").count();
    let opened = 0;
    for (let i = 0; i < Math.min(count, 60) && opened < MAX_DIALOG_OPENERS_PER_ROUTE; i++) {
      const button = page.locator("button:visible").nth(i);
      const label = (
        (await button.getAttribute("aria-label", { timeout: 1000 }).catch(() => null)) ??
        (await button.innerText({ timeout: 1000 }).catch(() => ""))
      )
        .replace(/\s+/g, " ")
        .trim();
      if (!label || NAV_LABELS.test(label)) continue;
      const before = page.url();
      await button.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(250);
      const dialogTitle = await page
        .evaluate(() => {
          const d = document.querySelector("dialog[open], [role=dialog], [role=alertdialog]");
          return d
            ? (d.querySelector("h1, h2, h3, [role=heading]")?.textContent ?? "dialog")
            : null;
        })
        .catch(() => null);
      if (dialogTitle !== null) {
        const key = `${route} ${dialogTitle}`;
        if (!openedDialogs.has(key)) {
          openedDialogs.add(key);
          opened += 1;
          await measure(`dialog ${route} ${label} -> ${dialogTitle.trim()}`);
        }
        await page.keyboard.press("Escape");
        await page.waitForTimeout(150);
      }
      if (page.url() !== before) {
        await page.goto(base + route);
        await settle();
      }
    }
  }

  await browser.close();

  const ranked = [...screens].sort((a, b) => b.cost - a.cost);
  const result = {
    score: scoreOf(screens),
    screens: screens.length,
    totals: {
      violations: screens.reduce((n, s) => n + s.violations.length, 0),
      excessWords: screens.reduce((n, s) => n + s.excessWords, 0),
      longTitles: screens.reduce((n, s) => n + s.counts.longTitles, 0),
      longHelp: screens.reduce((n, s) => n + s.counts.longHelp, 0),
      repeatedPhrases: screens.reduce((n, s) => n + s.counts.repeatedPhrases, 0),
      repeatedActions: screens.reduce((n, s) => n + s.counts.repeatedActions, 0),
    },
    worst: ranked.slice(0, top).map((s) => ({
      screen: s.name,
      cost: Math.round(s.cost * 10) / 10,
      words: s.words,
      violations: s.violations,
    })),
  };
  writeFileSync(join(shotsDir, "report.json"), JSON.stringify({ result, screens }, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
