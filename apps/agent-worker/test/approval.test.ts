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

async function run(steps: Step[], approval: "required" | "granted" | "not_needed" | undefined) {
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
    onMayHaveSubmitted: async () => undefined,
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

describeBrowser("a model that is cleared or approved", () => {
  for (const approval of ["not_needed", "granted"] as const) {
    it(`sends the form without stopping when the approval is ${approval}`, async () => {
      const { report } = await run(fillThenSubmit, approval);
      expect(report.kind).toBe("complete");
      expect((await fixtureState()).submissions).toHaveLength(1);
    });
  }
});
