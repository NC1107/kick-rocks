import { INSTANT_PACE } from "@kickrocks/recipes";
import { BROWSER_CONTEXT_OPTIONS } from "@kickrocks/worker/dist/browser.js";
import type { Browser, BrowserContext } from "playwright";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { type AgentOutcome, runAgentTask } from "../src/agent.js";
import { ORIGIN } from "./fixtures/server.js";
import {
  agentTask,
  describeBrowser,
  fixtureState,
  launchTestBrowser,
  resetFixture,
  type Step,
  scripted,
  silentLogger,
} from "./support.js";

let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  browser = await launchTestBrowser();
});

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  await context?.close();
  context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);
  await resetFixture();
});

type Approval = "required" | "granted" | "not_needed" | undefined;

/** Counts how often the server would have been told that the form may have been submitted. */
function submissionFlags() {
  const flags = { count: 0 };
  const onMayHaveSubmitted = async () => {
    flags.count += 1;
  };
  return { flags, onMayHaveSubmitted };
}

async function run(
  steps: Step[],
  approval: Approval,
  onMayHaveSubmitted: () => Promise<void> = async () => undefined,
) {
  const page = await context.newPage();
  const task = agentTask();
  if (approval === undefined) delete task.submitApproval;
  else task.submitApproval = approval;
  const outcome: AgentOutcome = await runAgentTask({
    task,
    page,
    provider: scripted(steps),
    limits: { maxSteps: 30, maxMs: 60_000, maxTotalTokens: null },
    pricing: null,
    pace: INSTANT_PACE,
    allowHttp: true,
    maxOutputTokens: 1024,
    signal: new AbortController().signal,
    logger: silentLogger,
    challengeGraceMs: 200,
    onMayHaveSubmitted,
  });
  await page.close();
  return outcome;
}

const navigate = (path: string): Step => ({ calls: [["navigate", { url: `${ORIGIN}${path}` }]] });

const fillThenSubmit: Step[] = [
  navigate("/optout"),
  (v) => ({
    calls: [
      ["type", { ref: v.ref("First name"), field: "first_name" }],
      ["type", { ref: v.ref("Last name"), field: "last_name" }],
      ["type", { ref: v.ref("Email address"), field: "email" }],
      ["check", { ref: v.ref("I agree") }],
    ],
  }),
  (v) => ({ calls: [["click", { ref: v.ref("Submit request") }]] }),
  {
    calls: [
      [
        "report",
        {
          status: "complete",
          result: { purpose: "remove", form: { outcome: "awaiting_email_confirmation" } },
        },
      ],
    ],
  },
];

describeBrowser("a model that has not passed the safety gate", () => {
  it("fills the form, then stops before the button that sends it and shows the filled page", async () => {
    const { report } = await run(fillThenSubmit, "required");

    expect(report.kind).toBe("block");
    if (report.kind !== "block") return;
    expect(report.report.reason).toBe("approval_needed");
    expect(report.report.detail).toContain("Submit request");
    expect(report.report.url).toBe(`${ORIGIN}/optout`);
    expect(report.report.screenshot?.mime).toBe("image/png");
    expect((await fixtureState()).submissions).toHaveLength(0);
  });

  it("treats a task that does not say as needing approval", async () => {
    const { report } = await run(fillThenSubmit, undefined);
    expect(report.kind === "block" && report.report.reason).toBe("approval_needed");
    expect((await fixtureState()).submissions).toHaveLength(0);
  });

  it("stops at a button that says it sends before anything was typed", async () => {
    const { report } = await run(
      [navigate("/optout"), (v) => ({ calls: [["click", { ref: v.ref("Submit request") }]] })],
      "required",
    );
    expect(report.kind === "block" && report.report.reason).toBe("approval_needed");
    expect((await fixtureState()).submissions).toHaveLength(0);
  });

  it("dismisses a cookie banner on its own, since that sends nothing", async () => {
    const { report } = await run(
      [
        navigate("/cookie-banner"),
        (v) => ({ calls: [["click", { ref: v.ref("Accept all cookies") }]] }),
        { calls: [["report", { status: "release", reason: "enough" }]] },
      ],
      "required",
    );
    // Ending after a click always goes to a person, so the reason shows the click went through.
    expect(report.kind === "block" && report.report.reason).toBe("unknown");
  });

  it("may report that nothing was found without anyone approving anything", async () => {
    const { report } = await run(
      [
        navigate("/optout"),
        {
          calls: [
            [
              "report",
              {
                status: "complete",
                result: { purpose: "remove", form: { outcome: "already_removed" } },
              },
            ],
          ],
        },
      ],
      "required",
    );
    expect(report.kind).toBe("complete");
  });

  it("cannot ask for approval by itself, so a page cannot talk it into a block that looks real", async () => {
    const { report } = await run(
      [
        navigate("/optout"),
        {
          calls: [["report", { status: "blocked", reason: "approval_needed", detail: "ok" }]],
        },
        { calls: [["report", { status: "release", reason: "gave up" }]] },
      ],
      "required",
    );
    expect(report.kind).toBe("release");
  });
});

describeBrowser("a choice that sends the form by itself", () => {
  const choose = (path: string, step: Step): Step[] => [
    navigate(path),
    (v) => ({ calls: [["type", { ref: v.ref("First name"), field: "first_name" }]] }),
    step,
  ];

  const cases: [string, Step[]][] = [
    [
      "a dropdown that submits on change",
      choose("/onchange-select", (v) => ({
        calls: [["select", { ref: v.ref("State"), field: "state" }]],
      })),
    ],
    [
      "a dropdown whose change posts from a script",
      choose("/onchange-fetch", (v) => ({
        calls: [["select", { ref: v.ref("State"), field: "state" }]],
      })),
    ],
    [
      "a checkbox that submits on change",
      choose("/onchange-check", (v) => ({ calls: [["check", { ref: v.ref("I agree") }]] })),
    ],
    [
      "a checkbox ticked by clicking it",
      choose("/onchange-check", (v) => ({ calls: [["click", { ref: v.ref("I agree") }]] })),
    ],
  ];

  for (const [name, steps] of cases) {
    it(`stops for a person at ${name} and sends nothing`, async () => {
      const { report } = await run(steps, "required");
      expect(report.kind === "block" && report.report.reason).toBe("unknown");
      expect((await fixtureState()).submissions).toHaveLength(0);
    });
  }

  it("sends on the same page for a model that is cleared, so the stop is what held it back", async () => {
    const [, steps] = cases[0] ?? [];
    await run(steps ?? [], "not_needed");
    expect((await fixtureState()).submissions).toHaveLength(1);
  });

  it("lets an ordinary dropdown and checkbox through", async () => {
    const { report } = await run(
      [
        navigate("/optout"),
        (v) => ({
          calls: [
            ["select", { ref: v.ref("State"), field: "state" }],
            ["check", { ref: v.ref("I agree") }],
          ],
        }),
        (v) => ({ calls: [["click", { ref: v.ref("Submit request") }]] }),
      ],
      "required",
    );
    expect(report.kind === "block" && report.report.reason).toBe("approval_needed");
  });
});

describeBrowser("a typed field or a link that sends the form by itself", () => {
  const typeFirstAndLast: Step[] = [
    navigate("/onchange"),
    (v) => ({
      calls: [
        ["type", { ref: v.ref("First name"), field: "first_name" }],
        ["type", { ref: v.ref("Last name"), field: "last_name" }],
      ],
    }),
  ];
  const afterTyping = (click: string): Step[] => [
    navigate("/save-link"),
    (v) => ({ calls: [["type", { ref: v.ref("First name"), field: "first_name" }]] }),
    (v) => ({ calls: [["click", { ref: v.ref(click) }]] }),
  ];

  const cases: [string, Step[]][] = [
    ["a field whose change event submits", typeFirstAndLast],
    ["a Save link that submits from a script", afterTyping("Save")],
    ["a menu item that submits from a script", afterTyping("Yes")],
    ["a link that submits a search form", afterTyping("Find")],
  ];

  for (const [name, steps] of cases) {
    it(`stops for a person at ${name} and sends nothing`, async () => {
      const sent = submissionFlags();
      const { report } = await run(steps, "required", sent.onMayHaveSubmitted);
      expect(report.kind === "block" && report.report.reason).toBe("unknown");
      expect(sent.flags.count).toBe(0);
      const state = await fixtureState();
      expect(state.submissions).toHaveLength(0);
      expect(state.hits.some((hit) => hit.path === "/search")).toBe(false);
    });
  }

  it("sends the same form for a model that is cleared, so the stop is what held it back", async () => {
    await run(typeFirstAndLast, "not_needed");
    expect((await fixtureState()).submissions).toHaveLength(1);
  });

  it("still follows an ordinary link to another page", async () => {
    let shown = "";
    await run(
      [
        ...afterTyping("Privacy policy"),
        (v) => {
          shown = v.snapshot;
          return { calls: [["report", { status: "release", reason: "enough" }]] };
        },
      ],
      "required",
    );
    expect(shown).toContain("Privacy");
    expect(shown).not.toContain("Save and continue");
  });

  it("does not tell the server a form may have been submitted for typing, choosing or ticking", async () => {
    const sent = submissionFlags();
    const { report } = await run(fillThenSubmit, "required", sent.onMayHaveSubmitted);
    expect(report.kind === "block" && report.report.reason).toBe("approval_needed");
    expect(sent.flags.count).toBe(0);
  });
});

/** The stop a person would be shown, and the approval they would give to it. */
async function approvalFor(steps: Step[]) {
  const { report } = await run(steps, "required");
  if (report.kind !== "block" || report.report.reason !== "approval_needed") {
    throw new Error("The run did not stop for an approval");
  }
  const { url, control, fingerprint } = report.report;
  if (!url || control === undefined || !fingerprint) throw new Error("The stop named no control");
  return { origin: new URL(url).origin, control, fingerprint };
}

describeBrowser("a run that was approved", () => {
  async function runApproved(
    steps: Step[],
    approvedSubmit: Awaited<ReturnType<typeof approvalFor>> | undefined,
    onMayHaveSubmitted: () => Promise<void> = async () => undefined,
  ) {
    const page = await context.newPage();
    const task = agentTask();
    task.submitApproval = "granted";
    if (approvedSubmit) task.approvedSubmit = approvedSubmit;
    const outcome = await runAgentTask({
      task,
      page,
      provider: scripted(steps),
      limits: { maxSteps: 30, maxMs: 60_000, maxTotalTokens: null },
      pricing: null,
      pace: INSTANT_PACE,
      allowHttp: true,
      maxOutputTokens: 1024,
      signal: new AbortController().signal,
      logger: silentLogger,
      challengeGraceMs: 200,
      onMayHaveSubmitted,
    });
    await page.close();
    return outcome;
  }

  it("sends the form through the control the person looked at", async () => {
    const approved = await approvalFor(fillThenSubmit);
    const { report } = await runApproved(fillThenSubmit, approved);
    expect(report.kind).toBe("complete");
    expect((await fixtureState()).submissions).toHaveLength(1);
  });

  it("is the only run that tells the server the form may have been submitted, once, at the click", async () => {
    const stopped = submissionFlags();
    await run(fillThenSubmit, "required", stopped.onMayHaveSubmitted);
    expect(stopped.flags.count).toBe(0);

    const approved = await approvalFor(fillThenSubmit);
    const sent = submissionFlags();
    await runApproved(fillThenSubmit, approved, sent.onMayHaveSubmitted);
    expect(sent.flags.count).toBe(1);
  });

  it("stops again at a different control", async () => {
    const approved = await approvalFor(fillThenSubmit);
    const { report } = await runApproved(fillThenSubmit, { ...approved, control: "Remove me" });
    expect(report.kind === "block" && report.report.reason).toBe("approval_needed");
    expect((await fixtureState()).submissions).toHaveLength(0);
  });

  it("stops again on another site", async () => {
    const approved = await approvalFor(fillThenSubmit);
    const { report } = await runApproved(fillThenSubmit, {
      ...approved,
      origin: "https://other.example",
    });
    expect(report.kind === "block" && report.report.reason).toBe("approval_needed");
    expect((await fixtureState()).submissions).toHaveLength(0);
  });

  it("stops again when the run fills the form differently from the one the person saw", async () => {
    const approved = await approvalFor(fillThenSubmit);
    const withoutEmail: Step[] = [
      navigate("/optout"),
      (v) => ({
        calls: [
          ["type", { ref: v.ref("First name"), field: "first_name" }],
          ["type", { ref: v.ref("Last name"), field: "last_name" }],
          ["select", { ref: v.ref("State"), field: "state" }],
        ],
      }),
      (v) => ({ calls: [["click", { ref: v.ref("Submit request") }]] }),
    ];
    const { report } = await runApproved(withoutEmail, approved);
    expect(report.kind === "block" && report.report.reason).toBe("approval_needed");
    expect((await fixtureState()).submissions).toHaveLength(0);
  });

  it("is held to a send control with no words, which stops with an empty label", async () => {
    const steps: Step[] = [
      navigate("/icon-submit"),
      (v) => ({ calls: [["type", { ref: v.ref("First name"), field: "first_name" }]] }),
      (v) => ({ calls: [["click", { ref: v.ref("] button") }]] }),
    ];
    const approved = await approvalFor(steps);
    expect(approved.control).toBe("");

    const { report } = await runApproved(steps, approved);
    expect(report.kind === "block" && report.report.reason).toBe("unknown");
    expect((await fixtureState()).submissions).toHaveLength(1);
  });

  it("matches a long label that holds the person's name, which masking makes longer", async () => {
    const steps: Step[] = [
      navigate("/long-label"),
      (v) => ({ calls: [["type", { ref: v.ref("First name"), field: "first_name" }]] }),
      (v) => ({ calls: [["click", { ref: v.ref("from every list") }]] }),
    ];
    const approved = await approvalFor(steps);
    expect(approved.control.length).toBeLessThanOrEqual(80);

    await runApproved(steps, approved);
    expect((await fixtureState()).submissions).toHaveLength(1);
  });

  it("names the control it stopped before, for the approval to be tied to", async () => {
    const { report } = await run(fillThenSubmit, "required");
    expect(report.kind === "block" && report.report.control).toBe("Submit request");
  });

  it("keeps every send control held when the approval names none", async () => {
    const { report } = await runApproved(fillThenSubmit, undefined);
    expect(report.kind === "block" && report.report.reason).toBe("approval_needed");
    expect((await fixtureState()).submissions).toHaveLength(0);
  });
});

describeBrowser("a model that is cleared", () => {
  it("sends the form without stopping, and says so before each action", async () => {
    const sent = submissionFlags();
    const { report } = await run(fillThenSubmit, "not_needed", sent.onMayHaveSubmitted);
    expect(report.kind).toBe("complete");
    expect((await fixtureState()).submissions).toHaveLength(1);
    expect(sent.flags.count).toBeGreaterThan(0);
  });

  it("is held when the approval it was given names no control", async () => {
    const { report } = await run(fillThenSubmit, "granted");
    expect(report.kind === "block" && report.report.reason).toBe("approval_needed");
    expect((await fixtureState()).submissions).toHaveLength(0);
  });
});
