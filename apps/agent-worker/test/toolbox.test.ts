import { INSTANT_PACE } from "@kickrocks/recipes";
import type { ProfileFields } from "@kickrocks/shared";
import { BROWSER_CONTEXT_OPTIONS } from "@kickrocks/worker/dist/browser.js";
import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createMask } from "../src/mask.js";
import { Toolbox, type ToolOutcome } from "../src/toolbox.js";
import { ORIGIN } from "./fixtures/server.js";
import { describeBrowser, fixtureState, launchTestBrowser, resetFixture } from "./support.js";

let browser: Browser;
let context: BrowserContext;
let page: Page;
let toolbox: Toolbox;

const PERSON: ProfileFields = {
  first_name: "Jordan",
  email: "jordan.example@example.com",
  state: "TX",
};

beforeAll(async () => {
  browser = await launchTestBrowser();
});

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  await toolbox?.dispose();
  await context?.close();
  context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);
  await resetFixture();
});

async function open(path: string, fields: ProfileFields = PERSON): Promise<void> {
  page = await context.newPage();
  toolbox = new Toolbox({
    page,
    fields,
    policy: { domains: ["127.0.0.1"], pages: [], allowHttp: true },
    pace: INSTANT_PACE,
    mask: createMask(fields),
    signal: new AbortController().signal,
    challengeGraceMs: 100,
  });
  await toolbox.install();
  await toolbox.execute("navigate", { url: `${ORIGIN}${path}` });
}

function textOf(outcome: ToolOutcome): string {
  if (outcome.kind !== "result") throw new Error(`Expected a result, got ${outcome.kind}`);
  return outcome.text;
}

async function refOf(label: string): Promise<string> {
  const text = textOf(await toolbox.execute("snapshot", {}));
  const line = text.split("\n").find((l) => /^\[e\d+\]/.test(l) && l.includes(label));
  const ref = line?.match(/^\[(e\d+)\]/)?.[1];
  if (!ref) throw new Error(`No control named ${label} in:\n${text}`);
  return ref;
}

describeBrowser("a human check that appears after the model acts", () => {
  it("stops the run when typing makes a CAPTCHA appear, before the model can click submit", async () => {
    await open("/late-captcha");
    const email = await refOf("Email address");
    const outcome = await toolbox.execute("type", { ref: email, field: "email" });
    expect(outcome.kind).toBe("challenge");
    if (outcome.kind === "challenge") expect(outcome.finding.reason).toBe("captcha");
    expect((await fixtureState()).submissions).toEqual([]);
  });

  it("stops the run when a choice makes a CAPTCHA appear", async () => {
    await open("/late-captcha?on=state");
    const state = await refOf("State");
    const outcome = await toolbox.execute("select", { ref: state, field: "state" });
    expect(outcome.kind).toBe("challenge");
  });

  it("refuses to click submit while a CAPTCHA that no snapshot showed is on the page", async () => {
    await open("/late-captcha?on=none");
    const submit = await refOf("Submit request");
    await page.evaluate(`document.getElementById("widget").style.display = "block"`);
    const outcome = await toolbox.execute("click", { ref: submit });
    expect(outcome.kind).toBe("challenge");
    expect(toolbox.clicks).toBe(0);
    expect((await fixtureState()).submissions).toEqual([]);
  });

  it("lets a click through on a page with no check", async () => {
    await open("/late-captcha?on=none");
    await toolbox.execute("type", { ref: await refOf("Email address"), field: "email" });
    const outcome = await toolbox.execute("click", { ref: await refOf("Submit request") });
    expect(outcome.kind).toBe("result");
    expect(toolbox.clicks).toBe(1);
    expect((await fixtureState()).submissions).toHaveLength(1);
  });
});

describeBrowser("a cookie banner over the page", () => {
  it("tells the model an overlay covers the page, and offers the banner's own buttons", async () => {
    await open("/cookie-banner");
    const text = textOf(await toolbox.execute("snapshot", {}));
    expect(text).toContain("A full-page overlay");
    expect(text).toContain("3 controls behind it cannot be used");
    expect(text).toContain('button "Accept all cookies"');
    expect(text).not.toContain('"First name"');
    expect(text).not.toContain('button "Submit request"');
  });

  it("shows the form once the banner is dismissed, and the form can be filled", async () => {
    await open("/cookie-banner");
    await toolbox.execute("click", { ref: await refOf("Accept all cookies") });
    const text = textOf(await toolbox.execute("snapshot", {}));
    expect(text).not.toContain("full-page overlay");
    expect(text).toContain('"First name"');
    const typed = await toolbox.execute("type", {
      ref: await refOf("First name"),
      field: "first_name",
    });
    expect(textOf(typed)).toContain("Typed first_name");
  });

  it("does not count a banner that covers only part of the page as an overlay", async () => {
    await open("/optout");
    const text = textOf(await toolbox.execute("snapshot", {}));
    expect(text).not.toContain("full-page overlay");
    expect(text).toContain('"First name"');
  });
});

describeBrowser("a long page", () => {
  it("shows the first part, says there is more, and shows the form on the last part", async () => {
    await open("/long-form");
    const first = textOf(await toolbox.execute("snapshot", {}));
    expect(first).toContain("part 1 of");
    expect(first).toContain("call snapshot with part 2");
    expect(first).not.toContain('"Email address"');
    const total = Number(/part 1 of (\d+)/.exec(first)?.[1]);
    expect(total).toBeGreaterThan(1);

    const last = textOf(await toolbox.execute("snapshot", { part: total }));
    expect(last).toContain(`part ${total} of ${total}, the last`);
    expect(last).toContain('"Email address"');

    const email = last
      .split("\n")
      .find((l) => l.includes('"Email address"'))
      ?.match(/^\[(e\d+)\]/)?.[1];
    const typed = await toolbox.execute("type", { ref: email, field: "email" });
    expect(textOf(typed)).toContain("Typed email");
  });

  it("says so when the part asked for does not exist", async () => {
    await open("/long-form");
    const text = textOf(await toolbox.execute("snapshot", { part: 40 }));
    expect(text).toMatch(/there is no part 40: the page has \d+ parts/);
  });

  it("masks the person's values in every part", async () => {
    await open("/long-form", { ...PERSON, first_name: "Story" });
    const text = textOf(await toolbox.execute("snapshot", { part: 2 }));
    expect(text).not.toContain("Story 1");
    expect(text).toContain("{{first_name}}");
  });
});

describeBrowser("a dropdown that stands in for a detail of the person", () => {
  it("refuses an option of a date of birth dropdown when the task has no date of birth", async () => {
    await open("/detail-selects");
    const outcome = await toolbox.execute("select", {
      ref: await refOf("Month"),
      option: "January",
    });
    const text = textOf(outcome);
    expect(outcome.kind === "result" && outcome.isError).toBe(true);
    expect(text).toContain("asks for the person's date of birth, which this task does not include");
    expect(text).toContain("blocked");
    expect(toolbox.clicks).toBe(0);
    expect(await page.inputValue("#month")).toBe("");
  });

  it("refuses an option of the state dropdown and points to the task's state field", async () => {
    await open("/detail-selects");
    const outcome = await toolbox.execute("select", {
      ref: await refOf("state"),
      option: "California",
    });
    const text = textOf(outcome);
    expect(outcome.kind === "result" && outcome.isError).toBe(true);
    expect(text).toContain("Choose it with select and field state");
    expect(await page.inputValue("#state")).toBe("");
  });

  it("chooses the person's own state by field, by its full name too", async () => {
    await open("/detail-selects");
    const outcome = await toolbox.execute("select", { ref: await refOf("state"), field: "state" });
    expect(outcome.kind === "result" && outcome.isError).toBe(false);
    expect(await page.inputValue("#state")).toBe("TX");
  });

  it("refuses the state dropdown outright when the task has no state", async () => {
    await open("/detail-selects", { first_name: "Jordan" });
    const outcome = await toolbox.execute("select", { ref: await refOf("state"), option: "Texas" });
    expect(textOf(outcome)).toContain("which this task does not include");
    expect(await page.inputValue("#state")).toBe("");
  });

  it("still lets a dropdown that asks for nothing about the person be chosen by option", async () => {
    await open("/detail-selects");
    const outcome = await toolbox.execute("select", {
      ref: await refOf("What is this about"),
      option: "Sale of my data",
    });
    expect(outcome.kind === "result" && outcome.isError).toBe(false);
    expect(await page.inputValue("#topic")).toBe("sale");
  });

  it("does not suggest choosing by option when the person's state matches nothing in the list", async () => {
    await open("/detail-selects", { ...PERSON, state: "WY" });
    const outcome = await toolbox.execute("select", { ref: await refOf("state"), field: "state" });
    const text = textOf(outcome);
    expect(text).toContain("No option of");
    expect(text).not.toContain("Choose one with option");
  });
});

describeBrowser("the person's state", () => {
  it("is typed into a text field as the task's state, and reads back as the field", async () => {
    await open("/detail-selects");
    const ref = await refOf("Residence state");
    expect(textOf(await toolbox.execute("type", { ref, field: "state" }))).toContain("Typed state");
    expect(await page.inputValue("#residence")).toBe("TX");
    const text = textOf(await toolbox.execute("snapshot", {}));
    expect(text).toContain('value="{{state}}"');
  });

  it("is hidden from the model wherever the page prints it, as a code or as a name", async () => {
    await open("/detail-selects");
    const text = textOf(await toolbox.execute("snapshot", {}));
    expect(text).toContain(
      "live in Austin, {{state}}, and the rest across {{state}} and Oregon (OR)",
    );
    expect(text).toContain('options: "Choose a state" | "{{state}}" | "California" | "Oregon"');
    expect(text).not.toContain("Texas");
  });
});
