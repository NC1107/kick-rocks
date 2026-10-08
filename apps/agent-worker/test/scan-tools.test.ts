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
    expect(answer.split("\n").slice(0, -1)).toEqual([
      `record: ${ORIGIN}/people/r1`,
      "name: matches",
      "place: found in current or past places",
      "birth year: matches",
      "age: not shown",
      "fits: report it",
    ]);
    expect(answer.split("\n").at(-1)).toMatch(/^So far: fits \S+\/people\/r1/);
  });

  it("says a card contradicts when the birth year and place differ", async () => {
    await open("/scan-cards");
    const answer = textOf(
      await toolbox.execute("check_record", { ref: await cardRef("{{first_name}} {{last_name}}") }),
    );
    expect(answer).toContain("place: absent");
    expect(answer).toContain("birth year: differs");
    expect(answer).toContain("\ncontradicts: leave it out\nSo far:");
  });

  it("counts a name that only an alias carries, and one that only a relative list carries, apart", async () => {
    await open("/scan-cards");
    const alias = textOf(await toolbox.execute("check_record", { ref: await cardRef("Dana") }));
    expect(alias).toContain("name: matches as an alias");
    const relative = textOf(await toolbox.execute("check_record", { ref: await cardRef("Sam") }));
    expect(relative).toContain("name: differs");
    expect(relative).toContain("\ncontradicts: leave it out\nSo far:");
  });

  it("sends a card that shows nothing to decide with to the record page", async () => {
    await open("/scan-cards");
    const answer = textOf(
      await toolbox.execute("check_record", { ref: await linkRef("/people/r5") }),
    );
    expect(answer).toContain("name: matches");
    expect(answer).toContain("place: not shown");
    expect(answer).toContain("\nnot decided: open the record page\nSo far:");
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

describeBrowser("the comparison of a results page", () => {
  const HEADER = "Kick Rocks compared the records on this page with the person (no values shown):";

  async function block(): Promise<string[]> {
    const text = await snapshot();
    const after = text.split("</page>\n")[1] ?? "";
    return after.split("\n").filter((line) => line !== "");
  }

  it("lists a verdict for each record under the snapshot, with its ref and link and no value", async () => {
    await open("/scan-cards");
    const lines = await block();
    expect(lines[0]).toBe(HEADER);
    const cards = lines.slice(1, -1);
    expect(cards).toHaveLength(5);
    const at = (id: string) => cards.find((line) => line.includes(`/people/${id}:`));
    expect(at("r1")).toMatch(new RegExp(`^\\[e\\d+\\] -> ${ORIGIN}/people/r1: fits$`));
    expect(at("r2")).toMatch(/: contradicts \(place differs, birth year differs\)$/);
    expect(at("r3")).toMatch(/: not decided, open it and call check_record there$/);
    expect(at("r4")).toMatch(/: contradicts \(name differs\)$/);
    expect(at("r5")).toMatch(/: not decided, open it and call check_record there$/);
    for (const value of Object.values(PERSON))
      expect(lines.join("\n")).not.toContain(value as string);
  });

  it("ends with what has been learned so far", async () => {
    await open("/scan-cards");
    const lines = await block();
    expect(lines.at(-1)).toBe(
      `So far: fits ${ORIGIN}/people/r1; not decided ${ORIGIN}/people/r3, ${ORIGIN}/people/r5; results pages seen /scan-cards.`,
    );
  });

  it("leaves out the header, the footer and a page with a single record", async () => {
    await open("/scan-cards");
    expect((await block()).join("\n")).not.toContain("/search");
    expect((await block()).join("\n")).not.toContain("/privacy");
    await toolbox.execute("navigate", { url: `${ORIGIN}/people/r1` });
    expect(await block()).toEqual([]);
  });

  it("is not given to a removal", async () => {
    await open("/scan-cards", "remove");
    expect(await block()).toEqual([]);
  });

  it("lets the record page overrule its card, and keeps that when the results are read again", async () => {
    await open("/scan-cards");
    await toolbox.execute("navigate", { url: `${ORIGIN}/people/r5` });
    const answer = textOf(await toolbox.execute("check_record", {}));
    expect(answer.split("\n")[0]).toBe(`record: ${ORIGIN}/people/r5`);
    expect(answer).toContain("\nfits: report it\n");
    expect(answer.split("\n").at(-1)).toBe(
      `So far: fits ${ORIGIN}/people/r1, ${ORIGIN}/people/r5; not decided ${ORIGIN}/people/r3; results pages seen /scan-cards.`,
    );
    const again = await toolbox.execute("navigate", { url: `${ORIGIN}/scan-cards` });
    const lines = (textOf(again).split("</page>\n")[1]?.split("\n") ?? []).filter(Boolean);
    expect(lines.find((line) => line.includes("/people/r5:"))).toMatch(/not decided/);
    expect(lines.at(-1)).toContain(`fits ${ORIGIN}/people/r1, ${ORIGIN}/people/r5`);
  });

  it("reads a ref of an empty string or none as no ref", async () => {
    await open("/scan-cards");
    await toolbox.execute("navigate", { url: `${ORIGIN}/people/r5` });
    for (const ref of ["", "none", "None", null]) {
      const answer = textOf(await toolbox.execute("check_record", { ref }));
      expect(answer.split("\n")[0]).toBe(`record: ${ORIGIN}/people/r5`);
    }
  });

  it("says a footer link is not a record link, instead of a verdict", async () => {
    await open("/scan-cards");
    const outcome = await toolbox.execute("check_record", { ref: await linkRef("/privacy") });
    expect(outcome.kind === "result" && outcome.isError).toBe(true);
    expect(textOf(outcome)).toMatch(
      /^e\d+ is not a record link\. On a record page call check_record without a ref\.$/,
    );
  });

  it("holds the report against it only once, and itemizes what is wrong", async () => {
    await open("/scan-cards");
    const verdicts = toolbox.scanVerdictsAgainst([`${ORIGIN}/people/r4`]);
    expect(verdicts).toEqual({
      missing: [`${ORIGIN}/people/r1`],
      contradicting: [`${ORIGIN}/people/r4`],
      unopened: [`${ORIGIN}/people/r3`, `${ORIGIN}/people/r5`],
    });
    await toolbox.execute("navigate", { url: `${ORIGIN}/people/r5` });
    expect(toolbox.scanVerdictsAgainst([]).unopened).toEqual([`${ORIGIN}/people/r3`]);
  });
});
