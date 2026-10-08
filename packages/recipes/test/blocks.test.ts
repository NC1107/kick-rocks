import type { Browser, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { type RunnerOptions, runCanary, runConfirmation, runRecipe } from "../src/index.js";
import { type FixtureServer, startFixtureServer } from "./fixture-server.js";
import {
  describeBrowser,
  FAST,
  JORDAN,
  launchTestBrowser,
  makeRecipe,
  type RecipeSpec,
} from "./support.js";

let server: FixtureServer;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  server = await startFixtureServer();
  browser = await launchTestBrowser();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

beforeEach(async () => {
  page = await (await browser.newContext()).newPage();
  server.submissions.length = 0;
  server.hits.length = 0;
});

afterEach(async () => {
  await page.context().close();
});

type Extra = Partial<Parameters<typeof runRecipe>[0]>;

function run(spec: Omit<RecipeSpec, "origin">, extra: Extra = {}) {
  return runRecipe({
    page,
    recipe: makeRecipe({ origin: server.origin, ...spec }),
    fields: JORDAN,
    targetDomain: "127.0.0.1",
    ...FAST,
    ...extra,
  });
}

const submitForm = [
  { kind: "fill", target: { label: "Email" }, field: "email" },
  { kind: "captcha_checkpoint" },
  { kind: "click", target: { role: "button", label: "Submit request" } },
];

function isPng(buffer: Buffer | null): boolean {
  return buffer !== null && buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
}

describeBrowser("CAPTCHA widgets", () => {
  it.each([
    ["recaptcha", "reCAPTCHA"],
    ["hcaptcha", "hCaptcha"],
    ["turnstile", "Cloudflare Turnstile"],
    ["image", "image CAPTCHA"],
  ])("blocks on a %s widget with a screenshot and submits nothing", async (name, label) => {
    const outcome = await run({ entry: `/captcha/${name}`, fields: ["email"], steps: submitForm });
    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.reason).toBe("captcha");
    expect(outcome.detail).toContain(label);
    expect(isPng(outcome.screenshot)).toBe(true);
    expect(server.submissions).toEqual([]);
  });

  it("blocks as soon as a page with a widget opens, before any step runs", async () => {
    const outcome = await run({
      entry: "/captcha/recaptcha",
      fields: ["email"],
      steps: [{ kind: "fill", target: { label: "Email" }, field: "email" }],
    });
    expect(outcome).toMatchObject({ status: "blocked", reason: "captcha" });
  });

  it("does not block on an invisible reCAPTCHA badge, and submits", async () => {
    const outcome = await run({
      entry: "/captcha/invisible",
      fields: ["email"],
      steps: submitForm,
    });
    expect(outcome).toEqual({ status: "completed", result: { outcome: "submitted" } });
    expect(server.submissions).toHaveLength(1);
  });

  it("does not block on a widget that already holds a solved response", async () => {
    const outcome = await run({ entry: "/captcha/solved", fields: ["email"], steps: submitForm });
    expect(outcome.status).toBe("completed");
  });

  it("blocks on a challenge that appears after a click", async () => {
    const outcome = await run({
      entry: "/captcha/after-click",
      steps: [
        { kind: "click", target: { role: "button", label: "Submit request" } },
        { kind: "click", target: { css: "#never" }, optional: true },
      ],
    });
    expect(outcome).toMatchObject({ status: "blocked", reason: "captcha" });
  });

  it("waits at a checkpoint for a widget that renders late", async () => {
    const outcome = await run(
      { entry: "/captcha/late", steps: [{ kind: "captcha_checkpoint" }] },
      { timeouts: { ...FAST.timeouts, checkpointMs: 2000 } },
    );
    expect(outcome).toMatchObject({ status: "blocked", reason: "captcha" });
  });

  it("reports a block instead of a missing selector when a widget hides the form", async () => {
    const outcome = await run({
      entry: "/captcha/late",
      steps: [{ kind: "click", target: { role: "button", label: "Submit request" } }],
    });
    expect(outcome).toMatchObject({ status: "blocked", reason: "captcha" });
  });

  it("blocks a scan the same way", async () => {
    const outcome = await run({
      purpose: "scan",
      entry: "/captcha/recaptcha",
      steps: [
        {
          kind: "extract_candidates",
          item: { css: ".result" },
          fields: { recordUrl: { css: "a", attr: "href" }, name: { css: "h3" } },
        },
      ],
    });
    expect(outcome).toMatchObject({ status: "blocked", reason: "captcha" });
  });
});

describeBrowser("bot walls", () => {
  const afterWall = [{ kind: "fill", target: { label: "Email" }, value: "typed" }];

  it("blocks for bot detection on a Cloudflare style interstitial, with a screenshot", async () => {
    const outcome = await run({ entry: "/wall/cloudflare", steps: afterWall });
    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.reason).toBe("bot_detection");
    expect(outcome.detail).toContain("Just a moment");
    expect(isPng(outcome.screenshot)).toBe(true);
  });

  it("blocks on an access denied page", async () => {
    const outcome = await run({ entry: "/wall/denied", steps: afterWall });
    expect(outcome).toMatchObject({ status: "blocked", reason: "bot_detection" });
  });

  it("blocks on a bare 403 whose body the detector has no words for, instead of failing the recipe", async () => {
    const outcome = await run({ entry: "/wall/blank", steps: afterWall });
    expect(outcome).toMatchObject({ status: "blocked", reason: "bot_detection" });
  });

  it("blocks when a step navigates to a bare 403", async () => {
    const outcome = await run({
      entry: "/form",
      steps: [{ kind: "goto", url: `${server.origin}/wall/blank` }, ...afterWall],
    });
    expect(outcome).toMatchObject({ status: "blocked", reason: "bot_detection" });
  });

  it("lets an interstitial that clears by itself pass", async () => {
    const outcome = await run({ entry: "/wall/auto", steps: afterWall });
    expect(outcome).toEqual({ status: "completed", result: { outcome: "submitted" } });
    expect(await page.inputValue("#w")).toBe("typed");
  });

  it("does not take a long article that mentions verification for a bot wall", async () => {
    const outcome = await run({
      entry: "/wall/long-article",
      steps: [{ kind: "expect_text", text: "Privacy guide" }],
    });
    expect(outcome.status).toBe("completed");
  });

  it("blocks when a step navigates into a bot wall", async () => {
    const outcome = await run({
      entry: "/form",
      steps: [{ kind: "goto", url: `${server.origin}/wall/cloudflare` }],
    });
    expect(outcome).toMatchObject({ status: "blocked", reason: "bot_detection" });
  });
});

describeBrowser("a canary", () => {
  const scanCanary = {
    purpose: "scan" as const,
    entry: "/ps/index",
    steps: [
      {
        kind: "extract_candidates",
        item: { css: ".result" },
        fields: { recordUrl: { css: "a", attr: "href" }, name: { css: "h3" } },
      },
    ],
  };
  const canary = (input: Parameters<typeof makeRecipe>[0]) =>
    runCanary({ page, recipe: makeRecipe(input), ...FAST });

  it("loads the entry page and nothing else, even when the recipe lists search steps", async () => {
    const outcome = await canary({
      ...scanCanary,
      origin: server.origin,
      canary: {
        url: "/ps/index",
        steps: [
          { kind: "fill", target: { label: "First name" }, value: "John" },
          { kind: "fill", target: { label: "Last name" }, value: "Smith" },
          { kind: "click", target: { role: "button", label: "Search" } },
          { kind: "wait_for", target: { css: "#results" } },
        ],
        selectors: [{ css: ".result" }, { css: "a.view" }],
        entrySelectors: [{ label: "First name" }, { role: "button", label: "Search" }],
      },
    });
    expect(outcome).toEqual({
      status: "completed",
      result: { healthy: true, missingSelectors: [] },
    });
    expect(server.hits).toEqual(["GET /ps/index"]);
    expect(server.submissions).toEqual([]);
  });

  it("is healthy when the page loads and the recipe names no entry selectors", async () => {
    const outcome = await canary({ ...scanCanary, origin: server.origin });
    expect(outcome).toEqual({
      status: "completed",
      result: { healthy: true, missingSelectors: [] },
    });
    expect(server.hits).toEqual(["GET /ps/index"]);
  });

  it("lists the entry selectors that are gone", async () => {
    const outcome = await canary({
      ...scanCanary,
      origin: server.origin,
      canary: {
        entrySelectors: [
          { label: "First name" },
          { role: "button", label: "Find" },
          { testId: "gone-box", css: "#gone" },
        ],
      },
    });
    expect(outcome).toEqual({
      status: "completed",
      result: {
        healthy: false,
        missingSelectors: ['role=button[name="Find"]', "testid=gone-box | css=#gone"],
      },
    });
  });

  it("finds an entry selector inside an iframe", async () => {
    const outcome = await canary({
      origin: server.origin,
      entry: "/frame/index",
      steps: [{ kind: "click", target: { css: "button" } }],
      canary: { entrySelectors: [{ label: "Email" }, { css: "iframe#optout" }] },
    });
    expect(outcome).toMatchObject({ status: "completed", result: { healthy: true } });
  });

  it("checks a removal recipe's selectors without clicking anything", async () => {
    const outcome = await canary({
      origin: server.origin,
      entry: "/form",
      steps: [{ kind: "click", target: { role: "button", label: "Submit request" } }],
      canary: {
        entrySelectors: [{ label: "Email" }, { role: "button", label: "Submit request" }],
      },
    });
    expect(outcome).toMatchObject({ status: "completed", result: { healthy: true } });
    expect(server.submissions).toEqual([]);
  });

  it("is blocked rather than unhealthy when a bare 403 hides the page", async () => {
    const outcome = await canary({
      ...scanCanary,
      origin: server.origin,
      entry: "/wall/blank",
      canary: { entrySelectors: [{ css: "form" }] },
    });
    expect(outcome).toMatchObject({ status: "blocked", reason: "bot_detection" });
  });

  it("is blocked rather than unhealthy when a human check hides the page", async () => {
    const outcome = await canary({
      origin: server.origin,
      entry: "/wall/cloudflare",
      steps: [{ kind: "click", target: { css: "button" } }],
      canary: { entrySelectors: [{ label: "Email" }] },
    });
    expect(outcome).toMatchObject({ status: "blocked", reason: "bot_detection" });
  });

  it("fails as a site failure when the entry page is down", async () => {
    const outcome = await canary({
      origin: server.origin,
      entry: "/boom",
      steps: [{ kind: "click", target: { css: "button" } }],
    });
    expect(outcome).toMatchObject({ status: "failed", kind: "site", retryable: true });
  });
});

describeBrowser("an email confirmation link", () => {
  const confirm = (url: string, extra: Partial<Pick<RunnerOptions, "allowHttp">> = {}) =>
    runConfirmation({ page, url, ...FAST, targetDomain: "127.0.0.1", ...extra });

  it("opens the link and reports it confirmed without the one-time token", async () => {
    const outcome = await confirm(`${server.origin}/mail/confirm?token=s3cret-token`);
    expect(outcome).toEqual({
      status: "completed",
      result: { confirmed: true, finalUrl: `${server.origin}/mail/confirm` },
    });
    expect(server.hits).toContain("GET /mail/confirm?token=s3cret-token");
  });

  it("presses the one button that confirms and reports where it led", async () => {
    const outcome = await confirm(`${server.origin}/mail/press?token=s3cret-token`);
    expect(outcome).toEqual({
      status: "completed",
      result: { confirmed: true, finalUrl: `${server.origin}/mail/press-submit` },
    });
    expect(server.submissions).toEqual([{ path: "/mail/press-submit", fields: {} }]);
  });

  it("reports a button that leads to an expired page as not confirmed", async () => {
    const outcome = await confirm(`${server.origin}/mail/press-stale`);
    expect(outcome).toMatchObject({
      status: "completed",
      result: { confirmed: false, notes: expect.stringContaining("expired") },
    });
  });

  it.each([
    ["a rate limit", "limited", 429, "rate_limited"],
    ["an outage", "unavailable", 503, "unavailable"],
  ])("fails retryably when the button's post meets %s", async (_name, page_, status, kind) => {
    const outcome = await confirm(`${server.origin}/mail/press-${page_}`);
    expect(outcome).toMatchObject({
      status: "failed",
      kind: "site",
      retryable: true,
      site: { pushback: { kind, status } },
    });
  });

  it("does not report a confirmation when the button's post is refused with a blank 403", async () => {
    const outcome = await confirm(`${server.origin}/mail/press-forbidden`);
    expect(outcome).toMatchObject({
      status: "completed",
      result: { confirmed: false, notes: "The site answered 403." },
      site: { pushback: { kind: "forbidden", status: 403 } },
    });
  });

  it("presses nothing and reports not confirmed when several buttons could be the one", async () => {
    const outcome = await confirm(`${server.origin}/mail/press-many`);
    expect(outcome).toMatchObject({ status: "completed", result: { confirmed: false } });
    expect(server.submissions).toEqual([]);
  });

  it("reports a page that says the link expired as not confirmed", async () => {
    const outcome = await confirm(`${server.origin}/mail/stale`);
    expect(outcome).toMatchObject({
      status: "completed",
      result: { confirmed: false, notes: expect.stringContaining("expired") },
    });
  });

  it("reports a missing page as not confirmed", async () => {
    const outcome = await confirm(`${server.origin}/mail/missing`);
    expect(outcome).toMatchObject({
      status: "completed",
      result: { confirmed: false, notes: "The site answered 404." },
    });
  });

  it("fails a server error as a retryable site failure", async () => {
    const outcome = await confirm(`${server.origin}/boom`);
    expect(outcome).toMatchObject({ status: "failed", kind: "site", retryable: true });
  });

  it("blocks on a bot wall", async () => {
    const outcome = await confirm(`${server.origin}/wall/cloudflare`);
    expect(outcome).toMatchObject({ status: "blocked", reason: "bot_detection" });
  });

  it.each([
    ["a link on another site", "https://example.test/confirm?token=abc"],
    ["a javascript link", "javascript:alert(1)"],
  ])("refuses %s without opening anything", async (_name, url) => {
    const outcome = await confirm(url);
    expect(outcome).toMatchObject({ status: "failed", kind: "internal", retryable: false });
    expect(server.hits).toEqual([]);
  });

  it("refuses http unless the caller allows it", async () => {
    const outcome = await confirm(`${server.origin}/mail/confirm?token=abc`, { allowHttp: false });
    expect(outcome).toMatchObject({ status: "failed", kind: "internal", retryable: false });
    expect(server.hits).toEqual([]);
  });

  it("keeps the token out of a failure message", async () => {
    const outcome = await confirm("http://127.0.0.1:1/confirm?token=s3cret-token");
    expect(outcome).toMatchObject({ status: "failed", kind: "network", retryable: true });
    expect(JSON.stringify(outcome)).not.toContain("s3cret-token");
  });
});
