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

describeBrowser("a human check that renders after the action returned", () => {
  it("stops a choice that would submit the form while a widget that showed up late is on the page", async () => {
    await open("/late-captcha-change");
    const email = await refOf("Email address");
    const state = await refOf("State");
    await toolbox.execute("type", { ref: email, field: "email" });
    await page.waitForFunction(`document.getElementById("widget").style.display === "block"`);
    const outcome = await toolbox.execute("select", { ref: state, field: "state" });
    expect(outcome.kind).toBe("challenge");
    expect(await page.inputValue("#state")).toBe("");
    expect((await fixtureState()).submissions).toEqual([]);
    expect(toolbox.clicks).toBe(0);
  });

  it("looks again after the server was told, right before the browser acts", async () => {
    let told = 0;
    await open("/late-captcha?on=none");
    await toolbox.dispose();
    toolbox = new Toolbox({
      page,
      fields: PERSON,
      policy: { domains: ["127.0.0.1"], pages: [], allowHttp: true },
      pace: INSTANT_PACE,
      mask: createMask(PERSON),
      signal: new AbortController().signal,
      challengeGraceMs: 100,
      onClick: async () => {
        told += 1;
        await page.evaluate(`document.getElementById("widget").style.display = "block"`);
      },
    });
    await toolbox.install();
    const submit = await refOf("Submit request");
    const outcome = await toolbox.execute("click", { ref: submit });
    expect(told).toBe(1);
    expect(outcome.kind).toBe("challenge");
    expect((await fixtureState()).submissions).toEqual([]);
  });

  it("stops typing too while a widget is on the page", async () => {
    await open("/late-captcha?on=none");
    const email = await refOf("Email address");
    await page.evaluate(`document.getElementById("widget").style.display = "block"`);
    const outcome = await toolbox.execute("type", { ref: email, field: "email" });
    expect(outcome.kind).toBe("challenge");
    expect(await page.inputValue("#email")).toBe("");
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
    await open("/bottom-banner");
    const text = textOf(await toolbox.execute("snapshot", {}));
    expect(text).not.toContain("full-page overlay");
    expect(text).toContain('"First name"');
    expect(text).toContain('button "Got it"');
  });

  it("offers the banner's own buttons above a backdrop without scrolling any link into view", async () => {
    await open("/many-links");
    await page.evaluate(`window.__scrolls = 0;
      const original = Element.prototype.scrollIntoViewIfNeeded;
      Element.prototype.scrollIntoViewIfNeeded = function (...args) { window.__scrolls += 1; return original.apply(this, args); };`);
    const text = textOf(await toolbox.execute("snapshot", {}));
    expect(text).toContain('link "Person 0"');
    expect(await page.evaluate("window.__scrolls")).toBe(0);
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

describeBrowser("refs across the parts of a page", () => {
  it("keep naming the same control after the page changed between two reads", async () => {
    await open("/long-form");
    const first = textOf(await toolbox.execute("snapshot", {}));
    const total = Number(/part 1 of (\d+)/.exec(first)?.[1]);
    const last = textOf(await toolbox.execute("snapshot", { part: total }));
    const email = last
      .split("\n")
      .find((l) => l.includes('"Email address"'))
      ?.match(/^\[(e\d+)\]/)?.[1];
    expect(email).toBeDefined();

    await page.evaluate(`const banner = document.createElement("button");
      banner.textContent = "Rotating offer";
      document.body.prepend(banner);`);
    const again = textOf(await toolbox.execute("snapshot", { part: 1 }));
    const offer = again.split("\n").find((l) => l.includes('"Rotating offer"'));
    expect(offer).toBeDefined();
    expect(offer).not.toContain(`[${email}]`);

    const typed = await toolbox.execute("type", { ref: email as string, field: "email" });
    expect(textOf(typed)).toContain("Typed email");
    expect(await page.inputValue("#email")).toBe(PERSON.email);
  });

  it("never hand a ref that a control once had to a different control", async () => {
    await open("/optout");
    const before = textOf(await toolbox.execute("snapshot", {}));
    const refs = [...before.matchAll(/^\[(e\d+)\]/gm)].map((m) => m[1]);
    await page.evaluate(`document.querySelector("input").remove();
      const extra = document.createElement("button");
      extra.textContent = "Extra";
      document.body.append(extra);`);
    const after = textOf(await toolbox.execute("snapshot", {}));
    const extra = after
      .split("\n")
      .find((l) => l.includes('"Extra"'))
      ?.match(/^\[(e\d+)\]/)?.[1];
    expect(extra).toBeDefined();
    expect(refs).not.toContain(extra);
  });
});

describeBrowser("a page with more items than a snapshot can hold", () => {
  it("says on its last part that the page was cut off", async () => {
    await open("/huge-page");
    const first = textOf(await toolbox.execute("snapshot", {}));
    const total = Number(/part 1 of (\d+)/.exec(first)?.[1]);
    expect(first).not.toContain("cut off");
    const last = textOf(await toolbox.execute("snapshot", { part: total }));
    expect(last).toContain("cut off after 3000 items");
    expect(last).not.toContain('"Email address"');
  });
});

describeBrowser("a part number sent the way a small model sends it", () => {
  it("is read when it is text, and null means the first part", async () => {
    await open("/long-form");
    const text = textOf(await toolbox.execute("snapshot", { part: "2" }));
    expect(text).toContain("part 2 of");
    expect(textOf(await toolbox.execute("snapshot", { part: null }))).toContain("part 1 of");
  });
});

describeBrowser("a date of birth in month, day and year dropdowns", () => {
  const WITH_DOB: ProfileFields = { ...PERSON, date_of_birth: "1990-04-05" };

  it("is filled one piece per dropdown when the task has the date", async () => {
    await open("/dob-selects", WITH_DOB);
    for (const label of ["Month", "Day", "Year"]) {
      const outcome = await toolbox.execute("select", {
        ref: await refOf(label),
        field: "date_of_birth",
      });
      expect(outcome.kind === "result" && outcome.isError, label).toBe(false);
    }
    expect(await page.inputValue("#month")).toBe("4");
    expect(await page.inputValue("#day")).toBe("5");
    expect(await page.inputValue("#year")).toBe("1990");
  });

  it("answers the year dropdown from the birth year, and refuses the month from it", async () => {
    await open("/dob-selects", { ...PERSON, birth_year: "1990" });
    const year = await toolbox.execute("select", { ref: await refOf("Year"), field: "birth_year" });
    expect(year.kind === "result" && year.isError).toBe(false);
    expect(await page.inputValue("#year")).toBe("1990");
    const month = await toolbox.execute("select", {
      ref: await refOf("Month"),
      field: "birth_year",
    });
    expect(textOf(month)).toContain("asks for the month of the date of birth");
    expect(await page.inputValue("#month")).toBe("");
  });

  it("answers the year dropdown from the date of birth when that is all the task has", async () => {
    await open("/dob-selects", WITH_DOB);
    const refused = await toolbox.execute("select", { ref: await refOf("Year"), option: "1990" });
    expect(textOf(refused)).toContain("select and field date_of_birth");
  });
});

describeBrowser("an optional dropdown that asks for a detail the task lacks", () => {
  it("is to be left unset, where a required one stops the run", async () => {
    await open("/detail-selects", { first_name: "Jordan" });
    const optional = await toolbox.execute("select", {
      ref: await refOf("City (optional)"),
      option: "Austin",
    });
    expect(textOf(optional)).toContain("It is optional: leave it unset");
    expect(textOf(optional)).not.toContain("Report blocked");
    const required = await toolbox.execute("select", { ref: await refOf("Month"), option: "May" });
    expect(textOf(required)).toContain("Report blocked");
  });

  it("is read by the name of an unlabelled control written in camel case", async () => {
    await open("/detail-selects", { first_name: "Jordan" });
    const outcome = await toolbox.execute("select", {
      ref: await refOf("zipCode"),
      option: "78701",
    });
    expect(textOf(outcome)).toContain("asks for the person's ZIP code");
  });
});

describeBrowser("a choice made by clicking in a custom list or a radio group", () => {
  async function picked(): Promise<string> {
    return page.evaluate(`document.getElementById("picked").textContent`);
  }

  it("refuses a state that is not the person's, however the list is built", async () => {
    await open("/custom-lists");
    const outcome = await toolbox.execute("click", { ref: await refOf("Alabama") });
    expect(outcome.kind === "result" && outcome.isError).toBe(true);
    expect(textOf(outcome)).toContain("only the option that reads {{state}} may be clicked");
    expect(await picked()).toBe("");
    expect(toolbox.clicks).toBe(0);
  });

  it("clicks the option that shows the person's own state, by name or by code", async () => {
    await open("/custom-lists");
    const named = await toolbox.execute("click", { ref: await refOf('option "{{state}}"') });
    expect(named.kind === "result" && named.isError).toBe(false);
    expect(await picked()).toBe("Texas;");
    expect(toolbox.clicks).toBe(1);
  });

  it("refuses a guessed year in a custom list of birth years when the task has no date of birth", async () => {
    await open("/custom-lists");
    const outcome = await toolbox.execute("click", { ref: await refOf('option "1985"') });
    expect(outcome.kind === "result" && outcome.isError).toBe(true);
    expect(textOf(outcome)).toContain(
      "asks for the person's year of birth, which this task does not include",
    );
    expect(await picked()).toBe("");
  });

  it("clicks the year that is the person's, and refuses the others", async () => {
    await open("/custom-lists", { ...PERSON, date_of_birth: "1990-04-05" });
    const wrong = await toolbox.execute("click", { ref: await refOf('option "1985"') });
    expect(wrong.kind === "result" && wrong.isError).toBe(true);
    const right = await toolbox.execute("click", { ref: await refOf('option "1990"') });
    expect(right.kind === "result" && right.isError).toBe(false);
    expect(await picked()).toBe("1990;");
  });

  it("refuses a radio button of another state, and ticks the person's", async () => {
    await open("/custom-lists");
    const wrong = await toolbox.execute("check", { ref: await refOf("Ohio") });
    expect(wrong.kind === "result" && wrong.isError).toBe(true);
    expect(await page.isChecked('input[value="OH"]')).toBe(false);
    const right = await toolbox.execute("check", { ref: await refOf('radio "{{state}}"') });
    expect(right.kind === "result" && right.isError).toBe(false);
    expect(await page.isChecked('input[value="TX"]')).toBe(true);
  });

  it("reads the name of a list from the control that opens it", async () => {
    await open("/custom-lists");
    const outcome = await toolbox.execute("click", { ref: await refOf("Dallas") });
    expect(textOf(outcome)).toContain(
      "asks for the person's city, which this task does not include",
    );
    expect(await picked()).toBe("");
  });

  it("leaves a list that asks for nothing about the person alone", async () => {
    await open("/custom-lists");
    const outcome = await toolbox.execute("click", { ref: await refOf("Business") });
    expect(outcome.kind === "result" && outcome.isError).toBe(false);
    expect(await picked()).toBe("Business;");
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
