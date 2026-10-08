import type { Browser, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { INSTANT_PACE, runConfirmation, runRecipe } from "../src/index.js";
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
  server.hits.length = 0;
});

afterEach(async () => {
  await page.context().close();
});

type Extra = Partial<Parameters<typeof runRecipe>[0]>;

function visit(entry: string, extra: Extra = {}, spec: Partial<RecipeSpec> = {}) {
  return runRecipe({
    page,
    recipe: makeRecipe({
      origin: server.origin,
      purpose: "scan",
      entry,
      steps: [
        {
          kind: "extract_candidates",
          item: { css: ".result" },
          fields: { recordUrl: { css: "a", attr: "href" }, name: { css: "h3" } },
        },
      ],
      ...spec,
    }),
    fields: JORDAN,
    targetDomain: "127.0.0.1",
    ...FAST,
    ...extra,
  });
}

describeBrowser("what a run reports about a site that pushes back", () => {
  it("reports a 429 with the wait the site asked for", async () => {
    const outcome = await visit("/limited");
    expect(outcome).toMatchObject({
      status: "failed",
      kind: "site",
      retryable: true,
      site: { pushback: { kind: "rate_limited", status: 429, retryAfterSeconds: 120 } },
    });
  });

  it("reports a 503 with its Retry-After", async () => {
    const outcome = await visit("/unavailable");
    expect(outcome).toMatchObject({
      status: "failed",
      site: { pushback: { kind: "unavailable", status: 503, retryAfterSeconds: 30 } },
    });
  });

  it("reports a bare 403 as the site refusing the browser", async () => {
    const outcome = await visit("/wall/blank");
    expect(outcome).toMatchObject({
      status: "blocked",
      reason: "bot_detection",
      site: { pushback: { kind: "forbidden", status: 403 } },
    });
  });

  it("reports a Cloudflare interstitial as a challenge, not as an ordinary 403", async () => {
    const outcome = await visit("/wall/cloudflare");
    expect(outcome).toMatchObject({
      status: "blocked",
      reason: "bot_detection",
      site: { pushback: { kind: "challenge", status: 403 } },
    });
  });

  it("reports a CAPTCHA on a page that loaded fine", async () => {
    const outcome = await visit("/captcha/recaptcha");
    expect(outcome).toMatchObject({
      status: "blocked",
      reason: "captcha",
      site: { pushback: { kind: "captcha" } },
    });
  });

  it("reports an access-denied page that answered 200", async () => {
    const outcome = await visit("/wall/denied-ok");
    expect(outcome).toMatchObject({
      status: "blocked",
      reason: "bot_detection",
      site: { pushback: { kind: "access_denied" } },
    });
  });

  const searchAfterSubmit = [
    { kind: "fill", target: { label: "First name" }, field: "first_name" },
    { kind: "fill", target: { label: "Last name" }, field: "last_name" },
    { kind: "click", target: { role: "button", label: "Search" } },
    {
      kind: "extract_candidates",
      item: { css: ".result" },
      fields: { recordUrl: { css: "a", attr: "href" }, name: { css: "h3" } },
    },
  ] as const;

  it("reports a 429 that answers the search submit, not a scan that found nobody", async () => {
    const outcome = await visit(
      "/ps/index-limited",
      {},
      {
        fields: ["first_name", "last_name"],
        steps: [...searchAfterSubmit],
      },
    );
    expect(outcome).toMatchObject({
      status: "failed",
      kind: "site",
      retryable: true,
      site: { pushback: { kind: "rate_limited", status: 429, retryAfterSeconds: 120 } },
    });
  });

  it("reports a 429 that sends the browser on to a friendly 200 page as the site pushing back", async () => {
    const outcome = await visit(
      "/ps/index-limited-redirect",
      {},
      { fields: ["first_name", "last_name"], steps: [...searchAfterSubmit] },
    );
    expect(outcome).toMatchObject({
      status: "blocked",
      site: { pushback: { kind: "rate_limited", status: 429, retryAfterSeconds: 120 } },
    });
  });

  it("fails a search whose 403 sends the browser on to a blank 200 page, which shows nothing", async () => {
    const outcome = await visit(
      "/ps/index-forbidden-redirect",
      {},
      { fields: ["first_name", "last_name"], steps: [...searchAfterSubmit] },
    );
    expect(outcome).toMatchObject({
      status: "failed",
      kind: "site",
      retryable: true,
      site: { pushback: { kind: "forbidden", status: 403 } },
    });
  });

  it("reports a search call that answers 429 in the background", async () => {
    const outcome = await visit(
      "/ps/index-xhr-limited",
      {},
      { fields: ["first_name", "last_name"], steps: [...searchAfterSubmit] },
    );
    expect(outcome).toMatchObject({
      status: "failed",
      kind: "site",
      retryable: true,
      site: { pushback: { kind: "rate_limited", status: 429, retryAfterSeconds: 120 } },
    });
  });

  it("reports a 403 that answers the search submit as the site refusing the browser", async () => {
    const outcome = await visit(
      "/ps/index-forbidden",
      {},
      {
        fields: ["first_name", "last_name"],
        steps: [...searchAfterSubmit],
      },
    );
    expect(outcome).toMatchObject({
      status: "blocked",
      reason: "bot_detection",
      site: { pushback: { kind: "forbidden", status: 403 } },
    });
  });

  it("reports pushback on a confirmation link too", async () => {
    const outcome = await runConfirmation({
      page,
      url: `${server.origin}/limited`,
      ...FAST,
      targetDomain: "127.0.0.1",
    });
    expect(outcome).toMatchObject({
      status: "failed",
      site: { pushback: { kind: "rate_limited", retryAfterSeconds: 120 } },
    });
  });

  it("says nothing about a site that answered normally", async () => {
    const outcome = await visit("/ps/index");
    expect(outcome.status).toBe("completed");
    expect(outcome).not.toHaveProperty("site");
  });
});

describeBrowser("how a run paces itself", () => {
  it("looks at a page before acting on it", async () => {
    const started = Date.now();
    const outcome = await visit("/ps/index", {
      pace: { ...INSTANT_PACE, dwellMs: [400, 400], scrollPx: [200, 200] },
    });
    expect(outcome.status).toBe("completed");
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
  });

  it("does not wait at all at the instant pace", async () => {
    const started = Date.now();
    await visit("/ps/index");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
