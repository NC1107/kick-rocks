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
  last_name: "Example",
  city: "Austin",
  state: "TX",
  birth_year: "1990",
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

async function open(path: string, purpose: "scan" | "remove" = "scan"): Promise<void> {
  page = await context.newPage();
  toolbox = new Toolbox({
    page,
    fields: PERSON,
    purpose,
    policy: { domains: ["127.0.0.1"], pages: [], allowHttp: true },
    pace: INSTANT_PACE,
    mask: createMask(PERSON),
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

async function snapshot(): Promise<string> {
  return textOf(await toolbox.execute("snapshot", {}));
}

async function refOf(label: string, role = ""): Promise<string> {
  const text = await snapshot();
  const line = text
    .split("\n")
    .find((l) => /^\[e\d+\]/.test(l) && l.includes(label) && l.includes(role));
  const ref = line?.match(/^\[(e\d+)\]/)?.[1];
  if (!ref) throw new Error(`No control named ${label} in:\n${text}`);
  return ref;
}

/** The ref of the link on the heading of a card, which the snapshot lists on the heading line. */
async function cardRef(name: string): Promise<string> {
  const text = await snapshot();
  const line = text.split("\n").find((l) => l.startsWith("heading(3)") && l.includes(name));
  const ref = line?.match(/\[(e\d+)\]/)?.[1];
  if (!ref) throw new Error(`No card for ${name} in:\n${text}`);
  return ref;
}

describeBrowser("check_record on a result card", () => {
  it("lists the name link of a card on its heading line", async () => {
    await open("/scan-cards");
    const text = await snapshot();
    expect(text).toMatch(
      /^heading\(3\) \[e\d+\] link "\{\{first_name\}\} A \{\{last_name\}\}" -> \S+\/people\/r1$/m,
    );
  });

  it("says a card fits when the name, place and birth year all match, ignoring the middle initial and the relatives", async () => {
    await open("/scan-cards");
    const answer = textOf(
      await toolbox.execute("check_record", { ref: await cardRef("{{first_name}} A") }),
    );
    expect(answer).toBe(
      [
        "name: matches",
        "place: found in current or past places",
        "birth year: matches",
        "age: not shown",
        "fits: report it",
      ].join("\n"),
    );
  });

  it("says a card contradicts when the birth year and place differ", async () => {
    await open("/scan-cards");
    const answer = textOf(
      await toolbox.execute("check_record", { ref: await cardRef("{{first_name}} {{last_name}}") }),
    );
    expect(answer).toContain("place: absent");
    expect(answer).toContain("birth year: differs");
    expect(answer.endsWith("contradicts: leave it out")).toBe(true);
  });

  it("counts a name that only an alias carries, and one that only a relative list carries, apart", async () => {
    await open("/scan-cards");
    const alias = textOf(await toolbox.execute("check_record", { ref: await cardRef("Dana") }));
    expect(alias).toContain("name: matches as an alias");
    const relative = textOf(await toolbox.execute("check_record", { ref: await cardRef("Sam") }));
    expect(relative).toContain("name: differs");
    expect(relative.endsWith("contradicts: leave it out")).toBe(true);
  });

  it("sends a card that shows nothing to decide with to the record page", async () => {
    await open("/scan-cards");
    const answer = textOf(
      await toolbox.execute("check_record", { ref: await linkRef("/people/r5") }),
    );
    expect(answer).toContain("name: matches");
    expect(answer).toContain("place: not shown");
    expect(answer.endsWith("not decided: open the record page")).toBe(true);
  });

  it("never prints a value of the person", async () => {
    await open("/scan-cards");
    const answer = textOf(
      await toolbox.execute("check_record", { ref: await cardRef("{{first_name}} A") }),
    );
    for (const value of Object.values(PERSON)) expect(answer).not.toContain(value as string);
  });

  it("refuses a ref that is not a link, and is not offered to a removal", async () => {
    await open("/scan-cards");
    const search = await refOf("Search", "button");
    expect(textOf(await toolbox.execute("check_record", { ref: search }))).toContain(
      "is not a link",
    );
    await toolbox.dispose();
    await open("/scan-cards", "remove");
    expect(textOf(await toolbox.execute("check_record", {}))).toContain("no tool named");
  });
});

async function linkRef(path: string): Promise<string> {
  const text = await snapshot();
  const line = text.split("\n").find((l) => /^\[e\d+\] link/.test(l) && l.includes(path));
  const ref = line?.match(/^\[(e\d+)\]/)?.[1];
  if (!ref) throw new Error(`No link to ${path} in:\n${text}`);
  return ref;
}

describeBrowser("a scan never sends a request", () => {
  it("refuses a button that posts to a removal form, whatever its label says", async () => {
    await open("/scan-cards");
    const outcome = await toolbox.execute("click", { ref: await refOf("Continue", "button") });
    expect(textOf(outcome)).toBe(
      "A scan never sends a request to the site. Report the records you have seen.",
    );
    expect(toolbox.clicks).toBe(0);
    expect((await fixtureState()).submissions).toEqual([]);
  });

  it("refuses a button whose own words name an unlock, and an input that posts to a do-not-sell form", async () => {
    await open("/scan-cards");
    expect(
      textOf(await toolbox.execute("click", { ref: await refOf("Unlock these results") })),
    ).toContain("A scan never sends a request");
    expect(textOf(await toolbox.execute("click", { ref: await refOf("Send") }))).toContain(
      "A scan never sends a request",
    );
    expect((await fixtureState()).submissions).toEqual([]);
  });

  it("still lets the search form and a link that opens a page through", async () => {
    await open("/scan-cards");
    const search = await toolbox.execute("click", { ref: await refOf("Search", "button") });
    expect(search.kind === "result" && search.isError).toBe(false);
    await toolbox.dispose();
    await open("/scan-cards");
    const link = await toolbox.execute("click", { ref: await linkRef("/people/r1") });
    expect(link.kind === "result" && link.isError).toBe(false);
    expect(page.url()).toContain("/people/r1");
  });

  it("leaves a removal free to send its form", async () => {
    await open("/scan-cards", "remove");
    await toolbox.execute("click", { ref: await refOf("Continue", "button") });
    expect((await fixtureState()).submissions).toHaveLength(1);
  });
});

describeBrowser("check_record on a record page", () => {
  it("reads the page being shown when no ref is given", async () => {
    await open("/scan-cards");
    await toolbox.execute("click", { ref: await linkRef("/people/r5") });
    const answer = textOf(await toolbox.execute("check_record", {}));
    expect(answer).toContain("name:");
    expect(answer).not.toContain("Jordan");
  });
});

describeBrowser("custom dropdowns and tabs in the snapshot", () => {
  it("shows what a button dropdown holds and whether its list is open", async () => {
    await open("/dropdowns");
    const text = await snapshot();
    expect(text).toContain('combobox "Kind of request" (collapsed) value="Delete my data"');
    expect(text).toContain('combobox "Product" (expanded) value="Search app"');
    expect(text).toContain('combobox "Pick a plan"');
  });

  it("marks the chosen option and the open tab", async () => {
    await open("/dropdowns");
    const text = await snapshot();
    expect(text).toMatch(/option "Free" \(selected\)/);
    expect(text).not.toMatch(/option "Paid" \(selected\)/);
    expect(text).toMatch(/tab "Overview" \(selected\)/);
    expect(text).not.toMatch(/tab "Details" \(selected\)/);
  });

  it("ends a page of one part with a note that it is the whole page", async () => {
    await open("/dropdowns");
    expect((await snapshot()).split("\n").at(-2)).toBe("(end of page)");
  });
});
