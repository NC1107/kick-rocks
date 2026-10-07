import type { Browser, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { runRecipe } from "../src/index.js";
import { type FixtureServer, startFixtureServer } from "./fixture-server.js";
import {
  describeBrowser,
  FAST,
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
});

afterEach(async () => {
  await page.context().close();
});

const button = (name: string) => ({ role: "button", label: name });

/** The shape of the Whitepages recipe: a wizard that ends on a code a person reads out on a call. */
const wizardSteps: RecipeSpec["steps"] = [
  { kind: "fill", target: { css: "#listing-url" }, field: "record_url" },
  { kind: "click", target: button("Next") },
  {
    kind: "outcome_when",
    when: [{ text: "not able to locate the listing", outcome: "not_found" }],
  },
  { kind: "wait_for", target: { text: "Is this the person you want to remove?" } },
  { kind: "click", target: button("Remove Me") },
  { kind: "wait_for", target: { text: "Please tell us why" } },
  {
    kind: "select",
    target: { css: "select.select" },
    value: "I just want to keep my information private",
  },
  { kind: "click", target: button("Next") },
  { kind: "wait_for", target: { text: "Verify your identity with a phone call" } },
  { kind: "fill", target: { css: '[data-qa-selector="phone-number"]' }, field: "phone" },
  { kind: "check", target: { css: 'input.checkbox[type="checkbox"]' } },
  { kind: "click", target: button("Call now to verify") },
  {
    kind: "outcome_when",
    when: [
      { text: "Your request to opt out has been accepted", outcome: "submitted" },
      { text: "Your verification code", outcome: "blocked", reason: "phone_verification" },
    ],
  },
];

function runWizard(recordUrl: string) {
  return runRecipe({
    page,
    recipe: makeRecipe({
      origin: server.origin,
      entry: "/wizard/index",
      fields: ["record_url", "phone"],
      steps: wizardSteps,
    }),
    fields: { record_url: recordUrl, phone: "555-0100" },
    targetDomain: "127.0.0.1",
    ...FAST,
  });
}

describeBrowser("a five step opt-out wizard", () => {
  it("walks every step and hands the verification call to a person", async () => {
    const outcome = await runWizard("https://www.example.com/name/Jordan-Example/Austin-TX/P1");
    expect(outcome).toMatchObject({ status: "blocked", reason: "phone_verification" });
    expect(await page.textContent("#code")).toBe("4821");
  });

  it("ends as not found when the site cannot match the listing URL", async () => {
    const outcome = await runWizard("https://www.example.com/somewhere-else");
    expect(outcome).toEqual({ status: "completed", result: { outcome: "not_found" } });
    expect(await page.locator("#step2").isHidden()).toBe(true);
  });
});
