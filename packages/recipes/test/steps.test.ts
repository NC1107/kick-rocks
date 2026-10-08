import type { Browser, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Pace, runRecipe } from "../src/index.js";
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

function run(
  spec: Omit<RecipeSpec, "origin">,
  fields: Record<string, string> = JORDAN,
  extra: Extra = {},
) {
  return runRecipe({
    page,
    recipe: makeRecipe({ origin: server.origin, ...spec }),
    fields,
    targetDomain: "127.0.0.1",
    ...FAST,
    ...extra,
  });
}

const filled = async (selector: string) => page.inputValue(selector);

describeBrowser("selector resolution order", () => {
  const fillWith = (target: object) => ({
    entry: "/selectors",
    steps: [{ kind: "fill", target, value: "typed" }],
  });

  it("prefers role and label over a test id and CSS that also match", async () => {
    await run(fillWith({ label: "Email address", testId: "email-box", css: ".email-css" }));
    expect([
      await filled("#by-label"),
      await filled("#by-testid"),
      await filled("#by-css"),
    ]).toEqual(["typed", "", ""]);
  });

  it("prefers a test id over CSS", async () => {
    await run(fillWith({ testId: "email-box", css: ".email-css" }));
    expect([
      await filled("#by-label"),
      await filled("#by-testid"),
      await filled("#by-css"),
    ]).toEqual(["", "typed", ""]);
  });

  it("prefers CSS over visible text", async () => {
    await run({
      entry: "/selectors",
      steps: [{ kind: "click", target: { css: "#text-link", text: "Search" } }],
    });
    expect(await page.textContent("#status")).toBe("clicked text link");
  });

  it("falls back to the next strategy when the first finds nothing", async () => {
    await run({
      entry: "/selectors",
      steps: [
        { kind: "click", target: { testId: "nope", css: "#nope", text: "Open the details" } },
      ],
    });
    expect(await page.textContent("#status")).toBe("clicked text link");
  });

  it("matches a role by its accessible name", async () => {
    await run({
      entry: "/selectors",
      steps: [{ kind: "click", target: { role: "button", label: "Search" } }],
    });
    expect(await page.textContent("#status")).toBe("clicked search");
  });

  it("acts on the visible element when a hidden twin comes first", async () => {
    await run(fillWith({ label: "Twin" }));
    expect(await filled("#twin-visible")).toBe("typed");
  });

  it("fails as a recipe failure that names the selector and the step", async () => {
    const outcome = await run({
      entry: "/selectors",
      steps: [
        { kind: "click", target: { role: "button", label: "Search" } },
        { kind: "click", target: { role: "button", label: "Nowhere" } },
      ],
    });
    expect(outcome).toEqual({
      status: "failed",
      kind: "recipe",
      error: 'click could not find role=button[name="Nowhere"]',
      retryable: false,
      step: 1,
    });
  });

  it("fails as a recipe failure on a selector that is not valid CSS", async () => {
    const outcome = await run({
      entry: "/selectors",
      steps: [{ kind: "click", target: { css: "###" } }],
    });
    expect(outcome).toMatchObject({ status: "failed", kind: "recipe", retryable: false, step: 0 });
  });
});

describeBrowser("templating", () => {
  it("renders every filter into a URL", async () => {
    await run({
      entry: "/echo",
      fields: ["first_name", "last_name", "full_name", "state"],
      steps: [
        {
          kind: "goto",
          url: `${server.origin}/echo?n={{first_name|slug}}&q={{full_name|urlencode}}&l={{last_name|lower}}&s={{state|state_name}}`,
        },
        { kind: "expect_text", text: "?n=jordan&q=Jordan%20Example&l=example&s=Texas" },
      ],
    });
    expect(server.hits).toContain("GET /echo?n=jordan&q=Jordan%20Example&l=example&s=Texas");
  });

  it("renders a value template into a field", async () => {
    await run({
      entry: "/form",
      fields: ["first_name", "last_name"],
      steps: [
        { kind: "fill", target: { label: "First name" }, value: "{{first_name}} {{last_name}}" },
      ],
    });
    expect(await filled("#first")).toBe("Jordan Example");
  });

  it("fails before opening any page when a field the recipe needs is missing", async () => {
    const outcome = await run(
      {
        entry: "/form",
        fields: ["email"],
        steps: [{ kind: "fill", target: { label: "Email" }, field: "email" }],
      },
      { first_name: "Jordan" },
    );
    expect(outcome).toEqual({
      status: "failed",
      kind: "internal",
      error:
        "This site needs an email address on the profile. Add it on the profile page, then retry.",
      retryable: false,
      step: undefined,
    });
    expect(server.hits).toEqual([]);
  });

  it("treats a blank field as missing so an empty value is never typed", async () => {
    const outcome = await run(
      {
        entry: "/form",
        fields: ["email"],
        steps: [{ kind: "fill", target: { label: "Email" }, field: "email" }],
      },
      { email: "   " },
    );
    expect(outcome).toMatchObject({ status: "failed", kind: "internal", retryable: false });
    expect(server.hits).toEqual([]);
  });

  it("fails the run rather than send a value it cannot render", async () => {
    const outcome = await run(
      {
        entry: "/form",
        fields: ["state"],
        steps: [{ kind: "fill", target: { label: "First name" }, value: "{{state|state_name}}" }],
      },
      { state: "ZZ" },
    );
    expect(outcome).toMatchObject({
      status: "failed",
      kind: "internal",
      retryable: false,
      step: 0,
    });
    expect(await filled("#first")).toBe("");
  });

  it("hides the person's values in a failure message", async () => {
    const outcome = await run({
      entry: "/form",
      fields: ["first_name"],
      steps: [{ kind: "goto", url: "http://127.0.0.1:1/{{first_name|slug}}" }],
    });
    expect(outcome).toMatchObject({ status: "failed", kind: "network", retryable: true });
    const error = outcome.status === "failed" ? outcome.error : "";
    expect(error).toContain("{{first_name}}");
    expect(error.toLowerCase()).not.toContain("jordan");
  });
});

describeBrowser("optional steps", () => {
  const dismissBanner = {
    kind: "click",
    target: { role: "button", label: "Accept cookies" },
    optional: true,
  };

  it("runs an optional step whose target is there", async () => {
    await run({ entry: "/banner?banner=1", steps: [dismissBanner] });
    expect(await page.title()).toBe("banner accepted");
  });

  it("skips an optional step whose target never shows up, and carries on", async () => {
    const started = Date.now();
    const outcome = await run(
      {
        entry: "/banner",
        steps: [dismissBanner, { kind: "fill", target: { label: "Name" }, value: "after" }],
      },
      JORDAN,
      { timeouts: { ...FAST.timeouts, stepMs: 60_000 } },
    );
    expect(outcome.status).toBe("completed");
    expect(await filled("#name")).toBe("after");
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it("skips an optional step in a frame that is not there", async () => {
    const outcome = await run({
      entry: "/banner",
      steps: [
        {
          kind: "click",
          frame: { css: "#nope" },
          target: { css: "button" },
          optional: true,
        },
      ],
    });
    expect(outcome.status).toBe("completed");
  });

  it("skips an optional fill when the profile has no value for it", async () => {
    const outcome = await run(
      {
        entry: "/form",
        fields: ["phone"],
        steps: [{ kind: "fill", target: { label: "First name" }, field: "phone", optional: true }],
      },
      { first_name: "Jordan" },
    );
    expect(outcome).toEqual({ status: "completed", result: { outcome: "submitted" } });
    expect(await filled("#first")).toBe("");
  });
});

describeBrowser("wait_for", () => {
  it("waits for an element to go away when the state is detached", async () => {
    const outcome = await run({
      entry: "/spinner",
      steps: [
        { kind: "wait_for", target: { css: "#spinner" }, state: "detached" },
        { kind: "expect_text", text: "All finished" },
      ],
    });
    expect(outcome.status).toBe("completed");
  });

  it("waits for an element to be hidden", async () => {
    const outcome = await run({
      entry: "/spinner",
      steps: [{ kind: "wait_for", target: { text: "Loading" }, state: "hidden" }],
    });
    expect(outcome.status).toBe("completed");
  });

  it("waits for an element that arrives late", async () => {
    const outcome = await run({
      entry: "/late",
      steps: [{ kind: "wait_for", target: { role: "button", label: "Continue" }, timeoutMs: 3000 }],
    });
    expect(outcome.status).toBe("completed");
  });

  it("waits for an element to be attached, even when it is not visible", async () => {
    const outcome = await run({
      entry: "/banner",
      steps: [{ kind: "wait_for", target: { css: "#cookie-banner" }, state: "attached" }],
    });
    expect(outcome.status).toBe("completed");
  });

  it("treats an element that never existed as already hidden", async () => {
    const outcome = await run({
      entry: "/banner",
      steps: [{ kind: "wait_for", target: { css: "#never" }, state: "hidden" }],
    });
    expect(outcome.status).toBe("completed");
  });

  it("fails as a recipe failure when the state is not reached in time", async () => {
    const outcome = await run({
      entry: "/banner",
      steps: [{ kind: "wait_for", target: { css: "#never" }, timeoutMs: 400 }],
    });
    expect(outcome).toMatchObject({ status: "failed", kind: "recipe", retryable: false, step: 0 });
  });

  it("skips an optional wait that times out", async () => {
    const outcome = await run({
      entry: "/banner",
      steps: [{ kind: "wait_for", target: { css: "#never" }, optional: true }],
    });
    expect(outcome.status).toBe("completed");
  });
});

describeBrowser("form controls", () => {
  const submit = { kind: "click", target: { role: "button", label: "Submit request" } };

  it("selects by label, ignoring case, and by value", async () => {
    await run({
      entry: "/form",
      fields: ["state"],
      steps: [{ kind: "select", target: { label: "State" }, value: "california" }, submit],
    });
    expect(server.submissions[0]?.fields.state).toBe("CA");

    server.submissions.length = 0;
    await run({
      entry: "/form",
      fields: ["state"],
      steps: [{ kind: "select", target: { label: "State" }, field: "state", by: "value" }, submit],
    });
    expect(server.submissions[0]?.fields.state).toBe("TX");
  });

  it("fails as a recipe failure when no option matches or the element is not a dropdown", async () => {
    const missing = await run({
      entry: "/form",
      steps: [{ kind: "select", target: { label: "State" }, value: "Narnia" }],
    });
    expect(missing).toMatchObject({ status: "failed", kind: "recipe", step: 0 });
    const custom = await run({
      entry: "/custom-select",
      steps: [{ kind: "select", target: { css: "#fake-select" }, value: "Texas" }],
    });
    expect(custom).toMatchObject({ status: "failed", kind: "recipe", step: 0 });
  });

  it("ticks and clears a checkbox", async () => {
    await run({
      entry: "/form",
      steps: [{ kind: "check", target: { label: "I confirm this is my information" } }, submit],
    });
    expect(server.submissions[0]?.fields.confirm).toBe("yes");

    server.submissions.length = 0;
    await run({
      entry: "/form",
      steps: [
        { kind: "check", target: { label: "I confirm this is my information" } },
        { kind: "check", target: { label: "I confirm this is my information" }, checked: false },
        submit,
      ],
    });
    expect(server.submissions[0]?.fields.confirm).toBeUndefined();
  });

  it("presses a key on a target to submit a form", async () => {
    await run({
      entry: "/form",
      fields: ["email"],
      steps: [
        { kind: "fill", target: { label: "Email" }, field: "email" },
        { kind: "press", key: "Enter", target: { label: "Email" } },
        { kind: "expect_url", pattern: "/form/submit$" },
        { kind: "expect_text", text: "Your request has been received" },
      ],
    });
    expect(server.submissions[0]?.fields.email).toBe("jordan@example.com");
  });

  it("fails an expect_url that does not hold", async () => {
    const outcome = await run({
      entry: "/form",
      steps: [{ kind: "expect_url", pattern: "/somewhere-else$" }],
    });
    expect(outcome).toMatchObject({ status: "failed", kind: "recipe", step: 0 });
  });

  it("fails an expect_text that does not hold", async () => {
    const outcome = await run({
      entry: "/form",
      steps: [{ kind: "expect_text", text: "Thank you for submitting" }],
    });
    expect(outcome).toEqual({
      status: "failed",
      kind: "recipe",
      error: 'expect_text: the page does not show "Thank you for submitting"',
      retryable: false,
      step: 0,
    });
  });

  it("accepts the confirm dialog a removal asks for", async () => {
    await run({
      entry: "/dialog",
      steps: [
        { kind: "click", target: { role: "button", label: "Remove my data" } },
        { kind: "expect_text", text: "removed" },
      ],
    });
    expect(await page.textContent("#result")).toBe("removed");
  });

  it("reads the record page address from a link", async () => {
    const outcome = await run({
      entry: "/ps/search",
      steps: [{ kind: "extract_text", target: { css: "a.view" }, as: "record_url" }],
    });
    expect(outcome).toEqual({
      status: "completed",
      result: {
        outcome: "submitted",
        notes: `Record page: ${server.origin}/ps/record/jordan-example-1`,
      },
    });
  });
});

describeBrowser("human pace", () => {
  function recordingPace(): { pace: Pace; sleeps: number[] } {
    const sleeps: number[] = [];
    return {
      sleeps,
      pace: {
        typeDelayMs: [20, 40],
        hesitationChance: 0,
        hesitationMs: [0, 0],
        actionPauseMs: [100, 100],
        pauseScale: 1,
        random: () => 0.5,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    };
  }

  it("types one key at a time with a delay after each, and pauses before the action", async () => {
    const { pace, sleeps } = recordingPace();
    await run(
      {
        entry: "/form",
        fields: ["email"],
        steps: [{ kind: "fill", target: { label: "Email" }, field: "email" }],
      },
      JORDAN,
      { pace },
    );
    expect(await filled("#email")).toBe("jordan@example.com");
    expect(sleeps.filter((ms) => ms === 30)).toHaveLength("jordan@example.com".length);
    expect(sleeps).toContain(100);
  });

  it("adds an occasional hesitation", async () => {
    const { pace, sleeps } = recordingPace();
    await run(
      {
        entry: "/form",
        steps: [{ kind: "fill", target: { label: "First name" }, value: "abcd" }],
      },
      JORDAN,
      { pace: { ...pace, hesitationChance: 1, hesitationMs: [300, 300] } },
    );
    expect(sleeps.filter((ms) => ms === 330)).toHaveLength(4);
  });

  it("scales the pause steps a recipe asks for", async () => {
    const { pace, sleeps } = recordingPace();
    await run({ entry: "/form", steps: [{ kind: "pause", minMs: 1000, maxMs: 1000 }] }, JORDAN, {
      pace: { ...pace, pauseScale: 0.5 },
    });
    expect(sleeps).toContain(500);
  });
});

describeBrowser("typed failures", () => {
  it("reports a refused connection as a retryable network failure", async () => {
    const outcome = await run({
      entry: "/form",
      steps: [{ kind: "goto", url: "http://127.0.0.1:1/" }],
    });
    expect(outcome).toMatchObject({ status: "failed", kind: "network", retryable: true });
  });

  it("reports a server error as a retryable site failure", async () => {
    const outcome = await run({ entry: "/boom", steps: [{ kind: "pause", minMs: 0, maxMs: 0 }] });
    expect(outcome).toMatchObject({
      status: "failed",
      kind: "site",
      error: "The site answered 500",
      retryable: true,
    });
  });

  it("reports rate limiting as a retryable site failure", async () => {
    const outcome = await run({
      entry: "/limited",
      steps: [{ kind: "pause", minMs: 0, maxMs: 0 }],
    });
    expect(outcome).toMatchObject({ status: "failed", kind: "site", retryable: true });
  });

  it("gives up on a run that outlasts its time limit", async () => {
    const outcome = await run(
      {
        entry: "/form",
        steps: [{ kind: "pause", minMs: 0, maxMs: 0 }],
      },
      JORDAN,
      { timeouts: { ...FAST.timeouts, runMs: -1 } },
    );
    expect(outcome).toMatchObject({ status: "failed", kind: "site", retryable: true });
  });

  it("stops promptly when the caller aborts mid-run", async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 300);
    const outcome = await run(
      {
        entry: "/form",
        steps: [{ kind: "wait_for", target: { css: "#never" }, timeoutMs: 30_000 }],
      },
      JORDAN,
      { signal: controller.signal },
    );
    expect(outcome).toMatchObject({ status: "failed", kind: "internal", retryable: true });
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  it("does not start a run that was aborted already", async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await run(
      { entry: "/form", steps: [{ kind: "pause", minMs: 0, maxMs: 0 }] },
      JORDAN,
      { signal: controller.signal },
    );
    expect(outcome).toMatchObject({ status: "failed", error: "The run was aborted" });
  });

  it("reports a closed page as a failure rather than throwing", async () => {
    const recipe = makeRecipe({
      origin: server.origin,
      entry: "/form",
      steps: [{ kind: "click", target: { role: "button", label: "Submit request" } }],
    });
    await page.close();
    const outcome = await runRecipe({ page, recipe, fields: JORDAN, ...FAST });
    expect(outcome.status).toBe("failed");
  });
});

describeBrowser("record URL checks", () => {
  const goToRecord = {
    entry: "/form",
    fields: ["record_url"] as "record_url"[],
    steps: [{ kind: "goto", url: "{{record_url}}" }],
  };
  const record = (record_url: string) => ({ ...JORDAN, record_url });

  it("opens a record on the broker's domain", async () => {
    const outcome = await run(goToRecord, record(`${server.origin}/rec/jordan-example-1`));
    expect(outcome.status).toBe("completed");
    expect(server.hits).toContain("GET /rec/jordan-example-1");
  });

  it("opens a record on a subdomain of the broker's domain", async () => {
    const outcome = await run(
      goToRecord,
      record(`${server.origin.replace("127.0.0.1", "records.localhost")}/rec/jordan-example-1`),
      { targetDomain: "localhost" },
    );
    expect(outcome.status).toBe("completed");
  });

  it.each([
    ["another host", "https://records.example.test/rec/1"],
    ["a host that only ends with the domain", "https://evil-127.0.0.1.example.test/rec/1"],
    ["a domain used as a prefix", "https://127.0.0.1.example.test/rec/1"],
    ["embedded credentials", "https://user:secret@127.0.0.1/rec/1"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<p>hi</p>"],
    ["a file URL", "file:///etc/passwd"],
    ["text that is not a URL", "not a url"],
  ])("refuses %s as a recipe failure without navigating", async (_name, url) => {
    const outcome = await run(goToRecord, record(url));
    expect(outcome).toMatchObject({ status: "failed", kind: "recipe", retryable: false, step: 0 });
    expect(server.hits.filter((hit) => hit.includes("/rec/"))).toEqual([]);
  });

  it("refuses a record URL on the local host name when the domain is the address", async () => {
    const outcome = await run(goToRecord, record(`${server.otherOrigin}/rec/jordan-example-1`));
    expect(outcome).toMatchObject({ status: "failed", kind: "recipe" });
    expect(server.hits.filter((hit) => hit.includes("/rec/"))).toEqual([]);
  });

  it("refuses http unless the caller allows it, which a real run never does", async () => {
    const outcome = await run(goToRecord, record(`${server.origin}/rec/jordan-example-1`), {
      allowHttp: false,
    });
    expect(outcome).toMatchObject({
      status: "failed",
      kind: "recipe",
      error: "The record URL is not an https URL",
      retryable: false,
    });
    expect(server.hits.filter((hit) => hit.includes("/rec/"))).toEqual([]);
  });

  it("fails when the record page sends the browser to another site", async () => {
    const outcome = await run(
      goToRecord,
      record(
        `${server.origin}/redirect?to=${encodeURIComponent(`${server.otherOrigin}/rec/jordan-example-1`)}`,
      ),
    );
    expect(outcome).toMatchObject({
      status: "failed",
      kind: "recipe",
      error: "The record page sent the browser to another site",
    });
  });

  it("defaults the domain to the host of the entry URL", async () => {
    const recipe = makeRecipe({ origin: server.origin, ...goToRecord });
    const outcome = await runRecipe({
      page,
      recipe,
      fields: record(`${server.otherOrigin}/rec/jordan-example-1`),
      ...FAST,
    });
    expect(outcome).toMatchObject({ status: "failed", kind: "recipe" });
  });
});

describe("page scripts", () => {
  it("are plain functions the page can run without helpers from the build tool", async () => {
    const { READ_FIELDS } = await import("../src/runner/page-scripts.js");
    expect(READ_FIELDS.toString()).not.toContain("__name");
  });
});
