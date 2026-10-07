import type { Browser, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { runRecipe } from "../src/index.js";
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

function run(
  spec: Omit<RecipeSpec, "origin">,
  fields: Record<string, string> = JORDAN,
  extra: Partial<Parameters<typeof runRecipe>[0]> = {},
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

const searchSteps = [
  { kind: "fill", target: { label: "First name" }, field: "first_name" },
  { kind: "fill", target: { label: "Last name" }, field: "last_name" },
  { kind: "click", target: { role: "button", label: "Search" } },
];

describeBrowser("a record URL removal form", () => {
  const spec = {
    entry: "/ps/index",
    fields: ["record_url", "email"],
    steps: [
      { kind: "goto", url: "{{record_url}}" },
      {
        kind: "outcome_when",
        when: [
          { text: "We could not find that record", outcome: "not_found" },
          { text: "was already removed", outcome: "already_removed" },
        ],
      },
      { kind: "fill", target: { label: "Email" }, field: "email" },
      { kind: "check", target: { label: "I agree to the terms" } },
      { kind: "click", target: { role: "button", label: "Remove this record" } },
      { kind: "expect_text", text: "will be removed within 48 hours" },
      { kind: "extract_text", target: { css: "#msg" }, as: "confirmation_text" },
    ],
  } satisfies Omit<RecipeSpec, "origin">;

  it("opens the confirmed record, fills the form, and reports the submission", async () => {
    const outcome = await run(spec, {
      ...JORDAN,
      record_url: `${server.origin}/rec/jordan-example-1`,
    });
    expect(outcome).toEqual({
      status: "completed",
      result: {
        outcome: "submitted",
        confirmationText: "Your record will be removed within 48 hours.",
      },
    });
    expect(server.submissions).toEqual([
      { path: "/rec/remove", fields: { email: "jordan@example.com", agree: "yes" } },
    ]);
  });

  it("ends as not_found, without submitting, when the record page says it is gone", async () => {
    const outcome = await run(spec, { ...JORDAN, record_url: `${server.origin}/rec/gone` });
    expect(outcome).toEqual({ status: "completed", result: { outcome: "not_found" } });
    expect(server.submissions).toEqual([]);
  });

  it("ends as already_removed when the record page says so", async () => {
    const outcome = await run(spec, { ...JORDAN, record_url: `${server.origin}/rec/already` });
    expect(outcome).toEqual({ status: "completed", result: { outcome: "already_removed" } });
    expect(server.submissions).toEqual([]);
  });
});

describeBrowser("a search-and-select removal", () => {
  const removal = (action: "check" | "click") => ({
    entry: "/ps/index",
    fields: ["first_name", "last_name", "record_url"] as (
      | "first_name"
      | "last_name"
      | "record_url"
    )[],
    steps: [
      ...searchSteps,
      {
        kind: "select_record",
        item: { css: ".result" },
        link: { css: "a.view", attr: "href" },
        action,
      },
      { kind: "click", target: { role: "button", label: "Request removal" } },
      {
        kind: "outcome_when",
        when: [{ text: "removal request was submitted", outcome: "submitted" }],
      },
    ],
  });

  it("ticks the result whose link names the confirmed record", async () => {
    const outcome = await run(removal("check"), {
      ...JORDAN,
      record_url: `${server.origin}/ps/record/jordan-example-1`,
    });
    expect(outcome).toEqual({ status: "completed", result: { outcome: "submitted" } });
    expect(server.submissions).toEqual([{ path: "/ps/remove", fields: { remove: "1" } }]);
  });

  it("matches through normalization: a trailing slash and a fragment do not matter", async () => {
    await run(removal("check"), {
      ...JORDAN,
      record_url: `${server.origin}/ps/record/jordan-example-2`,
    });
    expect(server.submissions[0]?.fields).toEqual({ remove: "2" });
  });

  it("ends as not_found, without submitting, when no result matches", async () => {
    const outcome = await run(removal("check"), {
      ...JORDAN,
      record_url: `${server.origin}/ps/record/jordan-example-99`,
    });
    expect(outcome).toMatchObject({ status: "completed", result: { outcome: "not_found" } });
    expect(server.submissions).toEqual([]);
  });

  it("clicks the matching result and carries on from the record page", async () => {
    const outcome = await run(
      {
        entry: "/ps/pick",
        fields: ["email", "record_url"],
        steps: [
          {
            kind: "select_record",
            item: { css: "a.pick" },
            link: { css: ":scope", attr: "href" },
            action: "click",
          },
          { kind: "fill", target: { label: "Email for confirmation" }, field: "email" },
          { kind: "click", target: { role: "button", label: "Remove this record" } },
        ],
      },
      { ...JORDAN, record_url: `${server.origin}/ps/record/jordan-example-1` },
    );
    expect(outcome).toEqual({ status: "completed", result: { outcome: "submitted" } });
    expect(server.submissions).toEqual([
      { path: "/ps/remove", fields: { email: "jordan@example.com" } },
    ]);
  });

  it("fails as a recipe failure when the results are not on the page at all", async () => {
    const outcome = await run(
      {
        entry: "/ps/empty",
        fields: ["record_url"],
        steps: [
          {
            kind: "select_record",
            item: { css: ".result" },
            link: { css: "a.view", attr: "href" },
            action: "check",
          },
        ],
      },
      { ...JORDAN, record_url: `${server.origin}/ps/record/jordan-example-1` },
    );
    expect(outcome).toMatchObject({ status: "failed", kind: "recipe", retryable: false, step: 0 });
  });
});

describeBrowser("a scan", () => {
  const scan = (entry = "/ps/index") => ({
    purpose: "scan" as const,
    entry,
    fields: ["first_name", "last_name"] as ("first_name" | "last_name")[],
    steps: [
      ...(entry === "/ps/index" ? searchSteps : []),
      {
        kind: "extract_candidates",
        item: { css: ".result" },
        fields: {
          recordUrl: { css: "a.view", attr: "href" },
          name: { css: ".name" },
          age: { css: ".age" },
          locations: { css: ".loc", all: true },
          relatives: { css: ".rel", all: true },
          phones: { css: ".phone", all: true },
          emails: { css: ".mail", all: true },
        },
      },
    ],
  });

  it("reads each result into a candidate with an absolute record URL", async () => {
    const outcome = await run(scan());
    expect(outcome).toEqual({
      status: "completed",
      result: {
        candidates: [
          {
            recordUrl: `${server.origin}/ps/record/jordan-example-1`,
            name: "Jordan Example",
            age: 34,
            locations: ["Austin, TX", "Dallas, TX"],
            relatives: ["Alex Example", "Sam Example"],
            phones: ["(555) 010-0101"],
            emails: ["jordan@example.com"],
          },
          {
            recordUrl: `${server.origin}/ps/record/jordan-example-2/`,
            name: "Jordan Example",
            age: 61,
            locations: ["Portland, OR"],
          },
        ],
      },
    });
    expect(server.hits).toContain("GET /ps/search?first=Jordan&last=Example");
  });

  it("reports no candidates when the page has no results", async () => {
    const outcome = await run(scan("/ps/empty"));
    expect(outcome).toEqual({ status: "completed", result: { candidates: [] } });
  });
});

describeBrowser("an email confirmation flow", () => {
  it("completes as awaiting_email_confirmation and names the sender domain", async () => {
    const outcome = await run({
      entry: "/mail/form",
      fields: ["email"],
      steps: [
        { kind: "fill", target: { label: "Email" }, field: "email" },
        { kind: "click", target: { role: "button", label: "Send confirmation email" } },
        { kind: "expect_text", text: "check your inbox" },
        { kind: "extract_text", target: { css: "h1" }, as: "confirmation_text" },
        { kind: "email_confirmation", fromDomain: "Mail.Optout.Example.test" },
      ],
    });
    expect(outcome).toEqual({
      status: "completed",
      result: {
        outcome: "awaiting_email_confirmation",
        confirmationText: "Check your inbox",
        confirmationFrom: "mail.optout.example.test",
      },
    });
    expect(server.submissions).toEqual([
      { path: "/mail/send", fields: { email: "jordan@example.com" } },
    ]);
  });

  it("ends with the first outcome_when that matches, even after email_confirmation", async () => {
    const outcome = await run({
      entry: "/mail/form",
      fields: ["email"],
      steps: [
        { kind: "fill", target: { label: "Email" }, field: "email" },
        { kind: "click", target: { role: "button", label: "Send confirmation email" } },
        { kind: "email_confirmation", fromDomain: "mail.optout.example.test" },
        {
          kind: "outcome_when",
          when: [
            { text: "confirmation link", outcome: "awaiting_email_confirmation" },
            { text: "check your inbox", outcome: "submitted" },
          ],
        },
      ],
    });
    expect(outcome).toMatchObject({
      status: "completed",
      result: {
        outcome: "awaiting_email_confirmation",
        confirmationFrom: "mail.optout.example.test",
      },
    });
  });
});

describeBrowser("a form inside an iframe", () => {
  it("scopes steps to the frame and sees the frame's result", async () => {
    const outcome = await run({
      entry: "/frame/index",
      fields: ["email"],
      steps: [
        { kind: "fill", frame: { css: "#optout" }, target: { label: "Email" }, field: "email" },
        {
          kind: "click",
          frame: { css: "#optout" },
          target: { role: "button", label: "Submit opt-out" },
        },
        { kind: "expect_text", text: "Framed request accepted" },
      ],
    });
    expect(outcome).toEqual({ status: "completed", result: { outcome: "submitted" } });
    expect(server.submissions).toEqual([
      { path: "/frame/submit", fields: { email: "jordan@example.com" } },
    ]);
  });

  it("fails as a recipe failure when the frame is not there", async () => {
    const outcome = await run({
      entry: "/form",
      fields: ["email"],
      steps: [
        { kind: "fill", frame: { css: "#nope" }, target: { label: "Email" }, field: "email" },
      ],
    });
    expect(outcome).toMatchObject({ status: "failed", kind: "recipe", step: 0 });
  });
});

describeBrowser("a human check that needs no step to fail", () => {
  it("blocks for phone verification through outcome_when", async () => {
    const outcome = await run({
      entry: "/rec/with-phone-wall",
      steps: [
        { kind: "click", target: { role: "button", label: "Remove this record" } },
        {
          kind: "outcome_when",
          when: [
            { selector: { css: "#phone-code" }, outcome: "blocked", reason: "phone_verification" },
          ],
        },
      ],
    });
    expect(outcome).toMatchObject({ status: "blocked", reason: "phone_verification" });
    expect(outcome.status === "blocked" && outcome.screenshot?.subarray(0, 4).toString("hex")).toBe(
      "89504e47",
    );
  });
});

describeBrowser("outcome_when", () => {
  const entry = "/rec/already";

  it("takes the first condition that matches, in order", async () => {
    const outcome = await run({
      entry,
      steps: [
        {
          kind: "outcome_when",
          when: [
            { text: "no such words here", outcome: "not_found" },
            { text: "already removed", outcome: "already_removed" },
            { text: "Record", outcome: "submitted" },
          ],
        },
      ],
    });
    expect(outcome).toEqual({ status: "completed", result: { outcome: "already_removed" } });
  });

  it("needs every part of a condition to hold", async () => {
    const steps = (urlPattern: string) => [
      {
        kind: "outcome_when",
        when: [{ text: "already removed", urlPattern, outcome: "already_removed" }],
      },
    ];
    expect(await run({ entry, steps: steps("/rec/already$") })).toMatchObject({
      result: { outcome: "already_removed" },
    });
    const mismatch = await run({ entry, steps: steps("/elsewhere$") });
    expect(mismatch).toEqual({ status: "completed", result: { outcome: "submitted" } });
  });

  it("matches on a pattern of the address alone", async () => {
    const outcome = await run({
      entry,
      steps: [
        {
          kind: "outcome_when",
          when: [{ urlPattern: "/rec/already", outcome: "not_found" }],
        },
      ],
    });
    expect(outcome).toMatchObject({ result: { outcome: "not_found" } });
  });

  it("carries on when no condition matches", async () => {
    const outcome = await run({
      entry,
      steps: [
        { kind: "outcome_when", when: [{ text: "never shown", outcome: "not_found" }] },
        { kind: "expect_text", text: "already removed" },
      ],
    });
    expect(outcome).toEqual({ status: "completed", result: { outcome: "submitted" } });
  });

  it("waits for a result that arrives after the submit", async () => {
    const outcome = await run(
      {
        entry: "/late",
        steps: [
          {
            kind: "outcome_when",
            when: [{ selector: { role: "button", label: "Continue" }, outcome: "not_found" }],
          },
        ],
      },
      JORDAN,
      { timeouts: { ...FAST.timeouts, outcomeSettleMs: 2500 } },
    );
    expect(outcome).toEqual({ status: "completed", result: { outcome: "not_found" } });
  });

  it("reports each blocked reason with a screenshot", async () => {
    for (const reason of [
      "id_upload",
      "login_required",
      "email_verification",
      "unknown",
    ] as const) {
      const outcome = await run({
        entry,
        steps: [
          {
            kind: "outcome_when",
            when: [{ text: "already removed", outcome: "blocked", reason }],
          },
        ],
      });
      expect(outcome).toMatchObject({ status: "blocked", reason });
    }
  });

  it("lets a scan end only as blocked", async () => {
    const outcome = await run({
      purpose: "scan",
      entry,
      steps: [
        {
          kind: "outcome_when",
          when: [{ text: "already removed", outcome: "blocked", reason: "login_required" }],
        },
        {
          kind: "extract_candidates",
          item: { css: ".result" },
          fields: { recordUrl: { css: "a", attr: "href" }, name: { css: "h3" } },
        },
      ],
    });
    expect(outcome).toMatchObject({ status: "blocked", reason: "login_required" });
  });
});

describeBrowser("a captcha checkpoint", () => {
  it("passes on a clean page", async () => {
    const outcome = await run({ entry: "/form", steps: [{ kind: "captcha_checkpoint" }] });
    expect(outcome).toEqual({ status: "completed", result: { outcome: "submitted" } });
  });
});
