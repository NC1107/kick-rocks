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
    expect(answer.split("\n").slice(0, 6)).toEqual([
      `record: ${ORIGIN}/people/r1`,
      "name: matches",
      "place: found in current or past places",
      "birth year: matches",
      "age: not shown",
      "fits: include it in your report",
    ]);
    expect(answer.split("\n")[6]).toMatch(/^So far: fits \S+\/people\/r1/);
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
    expect(answer).toContain(
      "\nnot decided: call check_record without a ref on the results page\nSo far:",
    );
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
    expect(textOf(await toolbox.execute("check_record", { ref: search }))).toBe(
      `${search} is not a record link; the records on this page are listed under the snapshot.`,
    );
    await toolbox.dispose();
    await open("/scan-cards", "remove");
    expect(textOf(await toolbox.execute("check_record", {}))).toContain("no tool named");
  });
});

/** The ref the comparison gives a record, which is the one on its heading. */
async function recordRef(path: string): Promise<string> {
  const text = await snapshot();
  const line = text.split("\n").find((l) => l.startsWith("heading(3)") && l.includes(path));
  const ref = line?.match(/\[(e\d+)\]/)?.[1];
  if (!ref) throw new Error(`No card for ${path} in:\n${text}`);
  return ref;
}

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
    await open("/people/r5");
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
    const cards = lines.slice(1, 6);
    expect(cards).toHaveLength(5);
    const at = (id: string) => cards.find((line) => line.includes(`/people/${id}:`));
    expect(at("r1")).toMatch(new RegExp(`^\\[e\\d+\\] -> ${ORIGIN}/people/r1: fits$`));
    expect(at("r2")).toMatch(/: contradicts \(place differs, birth year differs\)$/);
    expect(at("r3")).toMatch(/: not decided$/);
    expect(at("r4")).toMatch(/: contradicts \(name differs\)$/);
    expect(at("r5")).toMatch(/: not decided$/);
    for (const value of Object.values(PERSON))
      expect(lines.join("\n")).not.toContain(value as string);
  });

  it("ends with what has been learned so far", async () => {
    await open("/scan-cards");
    const lines = await block();
    expect(lines[6]).toBe(
      `So far: fits ${ORIGIN}/people/r1; not decided ${ORIGIN}/people/r3, ${ORIGIN}/people/r5; results pages seen /scan-cards.`,
    );
    expect(lines[7]).toBe(
      "Records marked not decided: call check_record without a ref on the results page.",
    );
    expect(lines).toHaveLength(8);
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
    expect(answer.split("\n").slice(0, 2)).toEqual([
      `record: ${ORIGIN}/people/r5`,
      "Already decided: fits.",
    ]);
    expect(answer.split("\n")[2]).toBe(
      `So far: fits ${ORIGIN}/people/r1, ${ORIGIN}/people/r5; not decided ${ORIGIN}/people/r3; results pages seen /scan-cards.`,
    );
    const again = await toolbox.execute("navigate", { url: `${ORIGIN}/scan-cards` });
    const lines = (textOf(again).split("</page>\n")[1]?.split("\n") ?? []).filter(Boolean);
    expect(lines.find((line) => line.includes("/people/r5:"))).toMatch(/: fits$/);
    expect(lines.find((line) => line.includes("/people/r3:"))).toMatch(/: not decided$/);
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
      /^e\d+ is not a record link; the records on this page are listed under the snapshot\.$/,
    );
  });

  it("holds the report against it only once, and itemizes what is wrong", async () => {
    await open("/scan-cards");
    // A card alone does not overrule a report; the record's own page does.
    const verdicts = toolbox.scanVerdictsAgainst([`${ORIGIN}/people/r4`]);
    expect(verdicts).toEqual({
      missing: [`${ORIGIN}/people/r1`],
      contradicting: [],
      unopened: [`${ORIGIN}/people/r3`, `${ORIGIN}/people/r5`],
    });
    await toolbox.execute("navigate", { url: `${ORIGIN}/people/r5` });
    expect(toolbox.scanVerdictsAgainst([]).unopened).toEqual([`${ORIGIN}/people/r3`]);
  });
});

describeBrowser("check_record on a results page with one record", () => {
  it("says the page lists one record and to open it, and gives no verdict on the results page", async () => {
    await open("/scan-single");
    const answer = textOf(await toolbox.execute("check_record", {}));
    expect(answer).toContain("This page lists one record");
    expect(answer).toContain(`${ORIGIN}/people/r1`);
    expect(answer).not.toMatch(/fits: include it|contradicts: leave it out/);
  });
});

describeBrowser("a scan that opens record pages on its own", () => {
  it("waits a few seconds between the pages it opens at a human pace, and not at an instant one", async () => {
    const pauses: number[] = [];
    const human = {
      ...INSTANT_PACE,
      pauseScale: 1,
      random: () => 0,
      sleep: async (ms: number) => {
        pauses.push(ms);
      },
    };
    page = await context.newPage();
    toolbox = new Toolbox({
      page,
      fields: PERSON,
      purpose: "scan",
      policy: { domains: ["127.0.0.1"], pages: [], allowHttp: true },
      pace: human,
      mask: createMask(PERSON),
      signal: new AbortController().signal,
      challengeGraceMs: 100,
    });
    await toolbox.install();
    await toolbox.execute("navigate", { url: `${ORIGIN}/scan-cards` });
    await toolbox.execute("check_record", {});
    expect(pauses.filter((ms) => ms >= 1500).length).toBeGreaterThanOrEqual(2);
  });
});

describeBrowser("a report that includes a record only its card contradicts", () => {
  it("opens that record's own page, and lets the page overrule the report", async () => {
    await open("/scan-cards");
    const r4 = `${ORIGIN}/people/r4`;
    expect(toolbox.scanVerdictsAgainst([r4]).contradicting).toEqual([]);
    await toolbox.openUnreadRecords([r4]);
    expect(toolbox.scanVerdictsAgainst([r4]).contradicting).toEqual([r4]);
  });
});

describeBrowser("check_record on a results page", () => {
  async function lines(outcome: ToolOutcome): Promise<string[]> {
    return textOf(outcome)
      .split("\n")
      .filter((line) => line !== "");
  }

  it("opens each record that is not decided, judges its own page, and comes back with one line per record", async () => {
    await open("/scan-cards");
    const answer = await lines(await toolbox.execute("check_record", {}));
    const record = (id: string) => answer.find((line) => line.includes(`/people/${id}:`));
    expect(record("r1")).toMatch(/: fits$/);
    expect(record("r2")).toMatch(/: contradicts \(place differs, birth year differs\)$/);
    expect(record("r3")).toMatch(/: contradicts \(name differs, place differs/);
    expect(record("r4")).toMatch(/: contradicts \(name differs\)$/);
    expect(record("r5")).toMatch(/: fits$/);
    expect(page.url()).toBe(`${ORIGIN}/scan-cards`);
    expect(answer.at(-1)).toBe(
      `Nothing is left to decide. Finish now: report {"status":"complete","records":["${ORIGIN}/people/r1","${ORIGIN}/people/r5"]}`,
    );
    for (const value of Object.values(PERSON))
      expect(answer.join("\n")).not.toContain(value as string);
  });

  it("keeps the refs of the results page usable after it has come back", async () => {
    await open("/scan-cards");
    const ref = await recordRef("/people/r5");
    await toolbox.execute("check_record", {});
    const again = await toolbox.execute("check_record", { ref });
    expect(textOf(again)).toContain("Already decided: fits.");
  });

  it("answers a record already decided from its own page without reading it again", async () => {
    await open("/scan-cards");
    await toolbox.execute("check_record", {});
    const hitsBefore = (await fixtureState()).hits.length;
    const answer = await lines(await toolbox.execute("check_record", {}));
    expect((await fixtureState()).hits.length).toBe(hitsBefore);
    expect(answer.at(-1)).toContain("Nothing is left to decide. Finish now: report");
  });

  it("only opens records the page showed, and never an opt-out page", async () => {
    await open("/scan-cards");
    await toolbox.execute("check_record", {});
    const paths = (await fixtureState()).hits;
    expect(paths.every((hit) => !/optout|remove|unlock/.test(hit.path))).toBe(true);
  });

  it("ignores a ref on a record page and judges the page, starting with its address", async () => {
    await open("/scan-cards");
    await toolbox.execute("navigate", { url: `${ORIGIN}/people/r3` });
    const answer = textOf(await toolbox.execute("check_record", { ref: "e1" }));
    expect(answer.split("\n")[0]).toBe(`record: ${ORIGIN}/people/r3`);
    expect(answer).toContain("contradicts");
  });

  it("never lists a results page or a link outside the record cards as a record", async () => {
    await open("/scan-cards");
    await toolbox.execute("check_record", { ref: await linkRef("/privacy") });
    await toolbox.execute("check_record", {});
    await toolbox.execute("navigate", { url: `${ORIGIN}/scan-cards` });
    expect(toolbox.scanVerdictsAgainst([]).missing).toEqual([
      `${ORIGIN}/people/r1`,
      `${ORIGIN}/people/r5`,
    ]);
  });

  it("takes the second link of a card as the card's record", async () => {
    await open("/scan-cards");
    const answer = textOf(
      await toolbox.execute("check_record", { ref: await linkRef("/people/r1") }),
    );
    expect(answer.split("\n")[0]).toBe(`record: ${ORIGIN}/people/r1`);
    expect(answer).toContain("fits: include it in your report");
  });
});

describeBrowser("results pages that lead to more", () => {
  async function block(outcome: ToolOutcome): Promise<string[]> {
    return (textOf(outcome).split("</page>\n")[1] ?? "").split("\n").filter((line) => line !== "");
  }

  it("lists the controls that lead to results not yet opened, and no finish line while any is left", async () => {
    await open("/scan-pages");
    const lines = await block(await toolbox.execute("snapshot", {}));
    const waiting = lines.find((line) => line.startsWith("Results pages linked here"));
    expect(waiting).toMatch(
      /^Results pages linked here that you have not opened: \[e\d+\] "2", \[e\d+\] "Next page"$/,
    );
    expect(lines.join("\n")).not.toContain("Nothing is left to decide");
  });

  it("counts a page as opened once it has been read, and ends with the finish line when nothing is left", async () => {
    await open("/scan-pages");
    await toolbox.execute("check_record", {});
    const second = await block(
      await toolbox.execute("navigate", { url: `${ORIGIN}/scan-pages-2` }),
    );
    expect(second.join("\n")).not.toContain("Results pages linked here");
    const decided = await toolbox.execute("check_record", {});
    expect(textOf(decided).split("\n").at(-1)).toBe(
      `Nothing is left to decide. Finish now: report {"status":"complete","records":["${ORIGIN}/people/p1","${ORIGIN}/people/p3"]}`,
    );
    expect(page.url()).toBe(`${ORIGIN}/scan-pages-2`);
  });

  it("offers a More button until pressing it brings no new records", async () => {
    await open("/scan-more");
    const first = await block(await toolbox.execute("snapshot", {}));
    expect(first.find((line) => line.startsWith("Results pages linked here"))).toMatch(
      /\[e\d+\] "View 1 more results", \[e\d+\] "Show more"$/,
    );
    const more = await toolbox.execute("click", { ref: await refOf("View 1 more results") });
    const afterMore = await block(more);
    expect(afterMore.find((line) => line.includes("/people/m3:"))).toBeDefined();
    expect(afterMore.find((line) => line.startsWith("Results pages linked here"))).toMatch(
      /\[e\d+\] "Show more"$/,
    );
    const nothing = await block(await toolbox.execute("click", { ref: await refOf("Show more") }));
    expect(nothing.join("\n")).not.toContain("Results pages linked here");
  });
});

describeBrowser("a scan stays off opt-out pages", () => {
  const STAY =
    "A scan stays on the search, results and record pages. Go on with the records listed under the results page.";

  it("refuses a click on a link whose words name an opt-out, and stays on the page", async () => {
    await open("/scan-cards");
    const outcome = await toolbox.execute("click", {
      ref: await refOf("Do not sell my information"),
    });
    expect(outcome.kind === "result" && outcome.isError).toBe(true);
    const [first, second] = textOf(outcome).split("\n");
    expect(first).toBe(STAY);
    expect(second).toMatch(/^So far: fits \S+\/people\/r1;/);
    expect(page.url()).toBe(`${ORIGIN}/scan-cards`);
  });

  it("refuses a click on a link whose address names an opt-out, whatever its words say", async () => {
    await open("/scan-cards");
    const outcome = await toolbox.execute("click", { ref: await refOf("About this site") });
    expect(textOf(outcome).split("\n")[0]).toBe(STAY);
    expect(page.url()).toBe(`${ORIGIN}/scan-cards`);
  });

  it("refuses to navigate to an opt-out, removal or privacy request address", async () => {
    await open("/scan-cards");
    for (const path of ["/optout", "/do-not-sell", "/remove-my-info", "/privacy-request"]) {
      const outcome = await toolbox.execute("navigate", { url: `${ORIGIN}${path}` });
      expect(textOf(outcome).split("\n")[0], path).toBe(STAY);
    }
    expect(page.url()).toBe(`${ORIGIN}/scan-cards`);
  });

  it("leaves a removal free to open the same pages", async () => {
    await open("/scan-cards", "remove");
    const outcome = await toolbox.execute("navigate", { url: `${ORIGIN}/optout` });
    expect(outcome.kind === "result" && outcome.isError).toBe(false);
    expect(page.url()).toBe(`${ORIGIN}/optout`);
  });

  it("still lets a link to a record through", async () => {
    await open("/scan-cards");
    const outcome = await toolbox.execute("click", { ref: await linkRef("/people/r1") });
    expect(outcome.kind === "result" && outcome.isError).toBe(false);
  });
});

describeBrowser("navigate with a path", () => {
  it("opens a path that starts with / on the current site", async () => {
    await open("/scan-cards");
    const outcome = await toolbox.execute("navigate", { url: "/people/r5" });
    expect(outcome.kind === "result" && outcome.isError).toBe(false);
    expect(page.url()).toBe(`${ORIGIN}/people/r5`);
  });

  it("does not take a path for another site", async () => {
    await open("/scan-cards");
    const outcome = await toolbox.execute("navigate", { url: "//other.test/people/r5" });
    expect(outcome.kind === "result" && outcome.isError).toBe(true);
    expect(page.url()).toBe(`${ORIGIN}/scan-cards`);
  });
});

describeBrowser("the records a report names", () => {
  it("finds a record by its link, its path, a unique tail of it or a ref, and nothing else", async () => {
    await open("/scan-cards");
    const ref = await linkRef("/people/r5");
    const found = toolbox.resolveRecords([
      `${ORIGIN}/people/r1`,
      "/people/r2",
      "people/r3",
      ref,
      "/people/r9",
      "r4",
    ]);
    expect(found.addresses).toEqual([
      `${ORIGIN}/people/r1`,
      `${ORIGIN}/people/r2`,
      `${ORIGIN}/people/r3`,
      `${ORIGIN}/people/r5`,
    ]);
    expect(found.unknown).toEqual(["/people/r9", "r4"]);
    expect(found.ambiguous).toEqual([]);
  });

  it("builds a candidate from the text of the card, with the real values and no relative among the places", async () => {
    await open("/scan-cards");
    expect(toolbox.candidateFor(`${ORIGIN}/people/r1`)).toEqual({
      recordUrl: `${ORIGIN}/people/r1`,
      name: "Jordan A Example",
      locations: ["Austin, TX"],
      relatives: ["Dana Example", "Pat Example"],
      phones: [],
      emails: [],
    });
  });

  it("builds it from the record page once that was opened", async () => {
    await open("/scan-cards");
    await toolbox.execute("navigate", { url: `${ORIGIN}/people/r5` });
    expect(toolbox.candidateFor(`${ORIGIN}/people/r5`)).toMatchObject({
      name: "Jordan Example",
      age: 35,
      locations: ["Austin, TX"],
    });
  });

  it("builds none for an address nothing was read of", async () => {
    await open("/scan-cards");
    expect(toolbox.candidateFor(`${ORIGIN}/privacy`)).toBeNull();
  });
});
