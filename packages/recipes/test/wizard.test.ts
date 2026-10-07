import { readFileSync } from "node:fs";
import type { Browser, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { BUNDLED_RECIPES_DIR, loadRecipesFromDir, runRecipe } from "../src/index.js";
import { type FixtureServer, startFixtureServer } from "./fixture-server.js";
import { describeBrowser, FAST, launchTestBrowser } from "./support.js";

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
});

afterEach(async () => {
  await page.context().close();
});

const recipe = (() => {
  const found = loadRecipesFromDir(BUNDLED_RECIPES_DIR, "bundled").recipes.find(
    (loaded) => loaded.recipe.id === "whitepages.remove.v2",
  );
  if (!found) throw new Error("whitepages.remove.v2 is not bundled");
  return found.recipe;
})();

const WIZARD_HTML = readFileSync(new URL("./fixtures/wizard/index.html", import.meta.url), "utf8");

interface Site {
  /** How long the lookup of a listing that does not exist takes to fail. */
  notFoundDelayMs: number;
  phoneCalls: number;
}

/** Serves the fixture as the Whitepages suppression page, so the bundled recipe is what runs. */
async function serveWhitepages(site: Site) {
  await page.route("https://www.whitepages.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/suppression-requests") {
      return route.fulfill({ contentType: "text/html", body: WIZARD_HTML });
    }
    if (url.pathname === "/api/person/details") {
      if ((url.searchParams.get("url") ?? "").includes("/name/")) {
        return route.fulfill({ contentType: "application/json", body: "{}" });
      }
      await new Promise((resolve) => setTimeout(resolve, site.notFoundDelayMs));
      return route.fulfill({ status: 404, body: "" });
    }
    if (url.pathname === "/api/suppression-requests/submit-phone") {
      site.phoneCalls += 1;
      return route.fulfill({ contentType: "application/json", body: "{}" });
    }
    return route.fulfill({ status: 404, body: "" });
  });
}

function runWizard(recordUrl: string) {
  return runRecipe({
    page,
    recipe,
    fields: { record_url: recordUrl },
    targetDomain: "www.whitepages.com",
    ...FAST,
  });
}

describeBrowser("the bundled Whitepages removal", () => {
  it("stops at the phone step before any number is typed or call is placed", async () => {
    const site: Site = { notFoundDelayMs: 0, phoneCalls: 0 };
    await serveWhitepages(site);
    const outcome = await runWizard("https://www.whitepages.com/name/Jordan-Example/Austin-TX/P1");
    expect(outcome).toMatchObject({ status: "blocked", reason: "phone_verification" });
    expect(await page.locator("#step4").isVisible()).toBe(true);
    expect(
      await page.locator('[data-qa-selector="suppression-requests-phone-number"]').inputValue(),
    ).toBe("");
    expect(await page.locator("#affirm").isChecked()).toBe(false);
    expect(site.phoneCalls).toBe(0);
  });

  it("does not ask for the phone number", () => {
    expect(recipe.fields).toEqual(["record_url"]);
  });

  it("ends as not found when the site cannot match the listing URL", async () => {
    await serveWhitepages({ notFoundDelayMs: 0, phoneCalls: 0 });
    const outcome = await runWizard("https://www.whitepages.com/somewhere-else");
    expect(outcome).toEqual({ status: "completed", result: { outcome: "not_found" } });
    expect(await page.locator("#step2").isHidden()).toBe(true);
  });

  it("still ends as not found when the failed lookup is slower than the settle time", async () => {
    await serveWhitepages({ notFoundDelayMs: 1200, phoneCalls: 0 });
    const outcome = await runWizard("https://www.whitepages.com/somewhere-else");
    expect(outcome).toEqual({ status: "completed", result: { outcome: "not_found" } });
  });
});
