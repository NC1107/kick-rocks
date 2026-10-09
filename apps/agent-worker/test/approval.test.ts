import { INSTANT_PACE } from "@kickrocks/recipes";
import type { SubmitGate } from "@kickrocks/shared";
import { BROWSER_CONTEXT_OPTIONS } from "@kickrocks/worker/dist/browser.js";
import type { Browser, BrowserContext } from "playwright";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { type AgentOutcome, runAgentTask } from "../src/agent.js";
import { FakeSends } from "./fake-sends.js";
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

type Gate = "hold" | "record" | "none" | "unsaid";

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
  gate: Gate,
  options: {
    sends?: FakeSends;
    approved?: SubmitGate["approved"];
    onMayHaveSubmitted?: () => Promise<void>;
  } = {},
): Promise<{ outcome: AgentOutcome; sends: FakeSends }> {
  const sends = options.sends ?? new FakeSends(() => "nobody");
  const page = await context.newPage();
  const task = agentTask();
  if (gate === "unsaid") delete task.submitApproval;
  else
    task.submitApproval =
      gate === "none" ? "not_needed" : gate === "hold" ? "required" : "not_needed";
  if (gate === "hold") {
    task.submitGate = { mode: "hold", holdMs: 800, approved: options.approved ?? [], declined: [] };
  }
  if (gate === "record") {
    task.submitGate = { mode: "record", holdMs: 0, approved: [], declined: [] };
  }
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
    sends,
    holdMsCap: 800,
    ...(options.onMayHaveSubmitted ? { onMayHaveSubmitted: options.onMayHaveSubmitted } : {}),
  });
  await page.close().catch(() => undefined);
  return { outcome, sends };
}

const navigate = (path: string): Step => ({ calls: [["navigate", { url: `${ORIGIN}${path}` }]] });
const report = (outcome: string): Step => ({
  calls: [["report", { status: "complete", result: { purpose: "remove", form: { outcome } } }]],
});

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
  report("awaiting_email_confirmation"),
];

function reasonOf(outcome: AgentOutcome): string | null {
  return outcome.report.kind === "block" ? outcome.report.report.reason : null;
}

describeBrowser("a model that has not passed the safety gate", () => {
  it("fills the form, holds the request the submit makes, and shows the page it was filled on", async () => {
    const { outcome, sends } = await run(fillThenSubmit, "hold");

    expect(outcome.report.kind).toBe("block");
    if (outcome.report.kind !== "block") return;
    expect(outcome.report.report.reason).toBe("approval_needed");
    expect(outcome.report.report.screenshot?.mime).toBe("image/png");
    expect(outcome.report.report.detail).toContain("DNS");
    expect((await fixtureState()).submissions).toHaveLength(0);
    expect(sends.held).toHaveLength(1);
    expect(sends.held[0]?.request).toMatchObject({
      method: "POST",
      path: "/optout",
      isDocument: true,
    });
  });

  it("treats a task that does not say as needing approval", async () => {
    const { outcome } = await run(fillThenSubmit, "unsaid");
    expect(reasonOf(outcome)).toBe("approval_needed");
    expect((await fixtureState()).submissions).toHaveLength(0);
  });

  it("holds nothing for a click that sends nothing, such as a cookie banner", async () => {
    const { outcome, sends } = await run(
      [
        navigate("/cookie-banner"),
        (v) => ({ calls: [["click", { ref: v.ref("Accept all cookies") }]] }),
        { calls: [["report", { status: "release", reason: "enough" }]] },
      ],
      "hold",
    );
    expect(sends.held).toEqual([]);
    expect(outcome.report.kind).toBe("release");
  });

  it("may report that nothing was found without anyone approving anything", async () => {
    const { outcome } = await run([navigate("/optout"), report("already_removed")], "hold");
    expect(outcome.report.kind).toBe("complete");
  });

  it("cannot ask for approval by itself, so a page cannot talk it into a block that looks real", async () => {
    const { outcome } = await run(
      [
        navigate("/optout"),
        { calls: [["report", { status: "blocked", reason: "approval_needed", detail: "ok" }]] },
        { calls: [["report", { status: "release", reason: "gave up" }]] },
      ],
      "hold",
    );
    expect(outcome.report.kind).toBe("release");
  });

  it("sends a released request exactly once, and does not take a finished form for another send", async () => {
    const sends = new FakeSends(() => "send");
    const { outcome } = await run(fillThenSubmit, "hold", { sends });
    expect(outcome.report.kind).toBe("complete");
    expect(sends.releases).toHaveLength(1);
    expect((await fixtureState()).submissions).toHaveLength(1);
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
    it(`holds the send at ${name} and sends nothing`, async () => {
      const { outcome, sends } = await run(steps, "hold");
      expect(reasonOf(outcome)).toBe("approval_needed");
      expect(sends.held.length).toBeGreaterThan(0);
      expect((await fixtureState()).submissions).toHaveLength(0);
    });
  }

  it("sends on the same page for a model that is cleared, so the gate is what held it back", async () => {
    const [, steps] = cases[0] ?? [];
    await run(steps ?? [], "none");
    expect((await fixtureState()).submissions).toHaveLength(1);
  });

  it("lets an ordinary dropdown and checkbox through to the submit it holds", async () => {
    const { outcome, sends } = await run(
      [
        navigate("/optout"),
        (v) => ({
          calls: [
            ["type", { ref: v.ref("First name"), field: "first_name" }],
            ["type", { ref: v.ref("Last name"), field: "last_name" }],
            ["type", { ref: v.ref("Email address"), field: "email" }],
            ["select", { ref: v.ref("State"), field: "state" }],
            ["check", { ref: v.ref("I agree") }],
          ],
        }),
        (v) => ({ calls: [["click", { ref: v.ref("Submit request") }]] }),
        report("awaiting_email_confirmation"),
      ],
      "hold",
    );
    expect(reasonOf(outcome)).toBe("approval_needed");
    expect(sends.held).toHaveLength(1);
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
  ];

  for (const [name, steps] of cases) {
    it(`holds the send at ${name} and sends nothing`, async () => {
      const sent = submissionFlags();
      const { outcome, sends } = await run(steps, "hold", {
        onMayHaveSubmitted: sent.onMayHaveSubmitted,
      });
      expect(reasonOf(outcome)).toBe("approval_needed");
      expect(sends.held.length).toBeGreaterThan(0);
      expect(sent.flags.count).toBe(0);
      const state = await fixtureState();
      expect(state.submissions).toHaveLength(0);
      expect(state.hits.some((hit) => hit.path === "/search")).toBe(false);
    });
  }

  it("lets a search form with nothing of the person in it through, and holds nothing", async () => {
    const { sends } = await run(afterTyping("Find"), "hold");
    expect((await fixtureState()).hits.some((hit) => hit.path === "/search")).toBe(true);
    expect(sends.held).toEqual([]);
  });

  it("sends the same form for a model that is cleared, so the gate is what held it back", async () => {
    await run(typeFirstAndLast, "none");
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
      "hold",
    );
    expect(shown).toContain("Privacy");
    expect(shown).not.toContain("Save and continue");
  });

  it("does not tell the server a form may have been submitted, because the gate knows what left", async () => {
    const sent = submissionFlags();
    const { outcome } = await run(fillThenSubmit, "hold", {
      onMayHaveSubmitted: sent.onMayHaveSubmitted,
    });
    expect(reasonOf(outcome)).toBe("approval_needed");
    expect(sent.flags.count).toBe(0);
  });
});

describeBrowser("a run with approvals from an earlier run", () => {
  async function approvalsOf(steps: Step[]) {
    const { sends } = await run(steps, "hold");
    return sends.held.map((held) => ({ id: held.id, request: held.request, resend: false }));
  }

  it("sends the request the person looked at, once", async () => {
    const approved = await approvalsOf(fillThenSubmit);
    const sends = new FakeSends(() => "nobody", [...approved]);
    const { outcome } = await run(fillThenSubmit, "hold", { sends, approved });
    expect(outcome.report.kind).toBe("complete");
    expect((await fixtureState()).submissions).toHaveLength(1);
    expect(sends.releases).toHaveLength(1);
    expect(sends.held).toEqual([]);
  });

  it("does not spend one approval twice", async () => {
    const approved = await approvalsOf(fillThenSubmit);
    const sends = new FakeSends(() => "nobody", [...approved]);
    const twice: Step[] = [
      ...fillThenSubmit.slice(0, -1),
      (v) => ({ calls: [["click", { ref: v.ref("Submit request") }]] }),
      report("awaiting_email_confirmation"),
    ];
    await run(twice, "hold", { sends, approved });
    expect((await fixtureState()).submissions.length).toBeLessThanOrEqual(1);
  });

  it("holds a request that fills the form differently from the one the person saw", async () => {
    const approved = await approvalsOf(fillThenSubmit);
    const withoutAgreeing: Step[] = [
      navigate("/optout"),
      (v) => ({
        calls: [
          ["type", { ref: v.ref("First name"), field: "first_name" }],
          ["type", { ref: v.ref("Last name"), field: "last_name" }],
          ["type", { ref: v.ref("Email address"), field: "email" }],
        ],
      }),
      (v) => ({ calls: [["click", { ref: v.ref("Submit request") }]] }),
    ];
    const sends = new FakeSends(() => "nobody", [...approved]);
    const { outcome } = await run(withoutAgreeing, "hold", { sends, approved });
    expect(reasonOf(outcome)).toBe("approval_needed");
    expect((await fixtureState()).submissions).toHaveLength(0);
  });

  it("holds a send control with no words as it does any other", async () => {
    const steps: Step[] = [
      navigate("/icon-submit"),
      (v) => ({ calls: [["type", { ref: v.ref("First name"), field: "first_name" }]] }),
      (v) => ({ calls: [["click", { ref: v.ref("] button") }]] }),
    ];
    const approved = await approvalsOf(steps);
    expect(approved).toHaveLength(1);
    const sends = new FakeSends(() => "nobody", [...approved]);
    await run(steps, "hold", { sends, approved });
    expect((await fixtureState()).submissions).toHaveLength(1);
  });

  it("holds a request that was approved for another site", async () => {
    const approved = await approvalsOf(fillThenSubmit);
    const elsewhere = approved.map((entry) => ({
      ...entry,
      request: { ...entry.request, host: "other.example" },
    }));
    const sends = new FakeSends(() => "nobody", [...elsewhere]);
    const { outcome } = await run(fillThenSubmit, "hold", { sends, approved: elsewhere });
    expect(reasonOf(outcome)).toBe("approval_needed");
    expect((await fixtureState()).submissions).toHaveLength(0);
  });
});

describeBrowser("a model that is cleared", () => {
  it("sends the form without stopping, and writes each send down before it leaves", async () => {
    const sends = new FakeSends(() => "send");
    const sent = submissionFlags();
    const { outcome } = await run(fillThenSubmit, "record", {
      sends,
      onMayHaveSubmitted: sent.onMayHaveSubmitted,
    });
    expect(outcome.report.kind).toBe("complete");
    expect((await fixtureState()).submissions).toHaveLength(1);
    expect(sent.flags.count).toBeGreaterThan(0);
    expect(sends.registered.filter((item) => item.kind === "released")).toHaveLength(1);
    expect(sends.held).toEqual([]);
  });

  it("does not let a form out when the server could not write the send down", async () => {
    const broken = new FakeSends(() => "send");
    broken.registerSends = async () => {
      throw new Error("the server is down");
    };
    await run(fillThenSubmit, "record", { sends: broken });
    expect((await fixtureState()).submissions).toHaveLength(0);
  });
});
