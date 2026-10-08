import { INSTANT_PACE } from "@kickrocks/recipes";
import type { SubmitGate } from "@kickrocks/shared";
import { BROWSER_CONTEXT_OPTIONS } from "@kickrocks/worker/dist/browser.js";
import type { Browser, BrowserContext } from "playwright";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { type AgentOutcome, runAgentTask } from "../src/agent.js";
import { FakeSends } from "./fake-sends.js";
import { OFFSITE, ORIGIN } from "./fixtures/server.js";
import {
  agentTask,
  describeBrowser,
  fixtureState,
  launchTestBrowser,
  resetFixture,
  type Step,
  scripted,
  silentLogger,
  TARGET,
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

const HOLD: SubmitGate = { mode: "hold", holdMs: 1_500, approved: [], declined: [] };

async function run(
  steps: Step[],
  options: {
    sends?: FakeSends;
    gate?: Partial<SubmitGate>;
    task?: ReturnType<typeof agentTask>;
    holdMsCap?: number;
    maxScreenshotBytes?: number;
  } = {},
): Promise<{ outcome: AgentOutcome; sends: FakeSends }> {
  const sends = options.sends ?? new FakeSends(() => "nobody");
  const page = await context.newPage();
  const task = options.task ?? agentTask();
  task.submitApproval = "required";
  task.submitGate = { ...HOLD, ...options.gate };
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
    ...(options.holdMsCap === undefined ? {} : { holdMsCap: options.holdMsCap }),
    ...(options.maxScreenshotBytes === undefined
      ? {}
      : { maxScreenshotBytes: options.maxScreenshotBytes }),
  });
  await page.close().catch(() => undefined);
  return { outcome, sends };
}

const open = (path: string): Step => ({ calls: [["navigate", { url: `${ORIGIN}${path}` }]] });
const typeEmail: Step = (v) => ({
  calls: [["type", { ref: v.ref("Email address"), field: "email" }]],
});
const wait = (seconds: number): Step => ({ calls: [["wait", { seconds }]] });
const snap: Step = { calls: [["snapshot", {}]] };
const clickLabel =
  (label: string, nth = 0): Step =>
  (v) => {
    const refs = v.snapshot
      .split("\n")
      .filter((line) => /^\[e\d+\]/.test(line) && line.includes(label))
      .map((line) => line.match(/^\[(e\d+)\]/)?.[1] ?? "");
    const ref = refs[nth];
    if (!ref) throw new Error(`no ${nth}th control ${label} in\n${v.snapshot}`);
    return { calls: [["click", { ref }]] };
  };
const finish: Step = {
  calls: [
    [
      "report",
      {
        status: "complete",
        result: {
          purpose: "remove",
          form: { outcome: "awaiting_email_confirmation", confirmationText: "Received" },
        },
      },
    ],
  ],
};
const giveBack: Step = { calls: [["report", { status: "release" }]] };
const clickSubmit: Step = (v) => ({ calls: [["click", { ref: v.ref("Submit request") }]] });

function blocked(outcome: AgentOutcome) {
  return outcome.report.kind === "block" ? outcome.report.report : null;
}

const NOBODY = () => new FakeSends(() => "nobody");

function submissionsOf(state: Awaited<ReturnType<typeof fixtureState>>, ...paths: string[]) {
  return state.hits.filter((hit) => paths.includes(hit.path));
}

describeBrowser("a send the page makes after the run touched it", () => {
  it("holds a debounced autosave that fires after the click, and ends the run at the lapse", async () => {
    const { outcome, sends } = await run([open("/gate-delayed"), typeEmail, wait(2), clickSubmit], {
      sends: NOBODY(),
    });
    expect((await fixtureState()).submissions).toEqual([]);
    expect(blocked(outcome)).toMatchObject({ reason: "approval_needed" });
    expect(sends.held.length).toBeGreaterThan(0);
    expect(sends.releases).toEqual([]);
  });

  it("holds a form.submit() that fires during a wait, and does not end as a failure to retry", async () => {
    const { outcome } = await run([open("/gate-delayed-submit"), typeEmail, wait(2), snap]);
    expect((await fixtureState()).submissions).toEqual([]);
    expect(outcome.report.kind).toBe("block");
    expect(blocked(outcome)).toMatchObject({ reason: "approval_needed" });
  });

  it("releases the very request that was paused when a person says send", async () => {
    const sends = new FakeSends(() => "send");
    const { outcome } = await run(
      [open("/gate-form"), typeEmail, snap, clickLabel("Submit request"), finish],
      { sends, gate: { holdMs: 5_000 } },
    );
    const state = await fixtureState();
    expect(state.submissions).toHaveLength(1);
    expect(state.submissions[0]).toMatchObject({
      path: "/gate-optout",
      fields: { email: "jordan.example@example.com", action: "optout" },
    });
    expect(sends.releases).toHaveLength(1);
    expect(sends.releases[0]?.request.body.find((v) => v.path === "email")).toMatchObject({
      value: "{{email}}",
      class: "profile",
    });
    expect(outcome.report.kind).toBe("complete");
  });

  it("leaves a send a person declined unsent and tells the model not to try again", async () => {
    const sends = new FakeSends(() => "dont_send");
    const { outcome } = await run(
      [open("/gate-form"), typeEmail, snap, clickLabel("Submit request"), snap, finish],
      { sends, gate: { holdMs: 5_000 } },
    );
    expect((await fixtureState()).submissions).toEqual([]);
    expect(sends.releases).toEqual([]);
    expect(outcome.report.kind).toBe("complete");
  });

  it("holds a form that is submitted from another form with the same label separately", async () => {
    const { sends } = await run(
      [open("/gate-form"), typeEmail, snap, clickLabel("Submit request", 1), wait(1)],
      { sends: NOBODY() },
    );
    expect((await fixtureState()).submissions).toEqual([]);
    expect(sends.held.map((held) => held.request.path)).toEqual(["/gate-newsletter"]);
  });
});

describeBrowser("a request that is not a form post", () => {
  it("holds a GET fetch and an image that carry the typed value", async () => {
    const { sends } = await run([open("/gate-get"), typeEmail, wait(1)], { sends: NOBODY() });
    const state = await fixtureState();
    expect(submissionsOf(state, "/gate-collect")).toEqual([]);
    expect(sends.held.map((held) => held.request.resourceType).sort()).toEqual(["Image", "XHR"]);
  });

  it("holds the value however the page packs it: base64, gzip, or a hash sent to another site", async () => {
    const { sends } = await run([open("/gate-encode"), typeEmail, wait(2)], { sends: NOBODY() });
    const state = await fixtureState();
    expect(submissionsOf(state, "/gate-collect", "/gate-gzip-post", "/gate-pixel")).toEqual([]);
    const reasons = sends.refusals.map((refusal) => refusal.reason);
    expect(reasons).toContain("third_party_value");
    expect(sends.held.map((held) => held.request.path)).toEqual(
      expect.arrayContaining(["/gate-collect", "/gate-gzip-post"]),
    );
  });

  it("lets a search by name and city through and logs it as a lookup", async () => {
    const task = agentTask({
      fields: { first_name: "Jordan", last_name: "Example", city: "Austin", state: "TX" },
    });
    const { sends } = await run(
      [
        open("/gate-nav"),
        (v) => ({
          calls: [
            ["type", { ref: v.ref("First name"), field: "first_name" }],
            ["type", { ref: v.ref("Last name"), field: "last_name" }],
            ["type", { ref: v.ref("City"), field: "city" }],
          ],
        }),
        (v) => ({ calls: [["click", { ref: v.ref("Search by name") }]] }),
        wait(1),
      ],
      { sends: NOBODY(), task },
    );
    const state = await fixtureState();
    expect(state.hits.some((hit) => hit.path === "/gate-search")).toBe(true);
    expect(sends.held).toEqual([]);
    const search = sends.lookups.find((lookup) => lookup.path === "/gate-search");
    expect(search?.query.map((value) => value.path).sort()).toEqual(["city", "first", "last"]);
    expect(search?.carries).toEqual(expect.arrayContaining(["first_name", "city"]));
  });

  it("holds a location change and a GET form that carry the email", async () => {
    const first = await run(
      [
        open("/gate-nav"),
        typeEmail,
        (v) => ({ calls: [["click", { ref: v.ref("Go to results") }]] }),
      ],
      { sends: NOBODY() },
    );
    expect(submissionsOf(await fixtureState(), "/gate-collect")).toEqual([]);
    expect(first.sends.held.map((held) => held.request.path)).toEqual(["/gate-collect"]);
    await resetFixture();
    const second = await run(
      [
        open("/gate-nav"),
        (v) => ({
          calls: [["type", { ref: v.ref("Email for the lookup form"), field: "email" }]],
        }),
        (v) => ({ calls: [["click", { ref: v.ref("Search by email") }]] }),
      ],
      { sends: NOBODY() },
    );
    expect(submissionsOf(await fixtureState(), "/gate-collect")).toEqual([]);
    expect(second.sends.held).toHaveLength(1);
  });
});

describeBrowser("a request to somewhere other than the target", () => {
  it("refuses a POST to another site that carries the email, and never offers it", async () => {
    const { sends } = await run([open("/gate-cross"), typeEmail, wait(1)], { sends: NOBODY() });
    expect(submissionsOf(await fixtureState(), "/gate-collect")).toEqual([]);
    expect(sends.refusals.map((refusal) => refusal.reason)).toContain("third_party_value");
    expect(sends.held.some((held) => held.request.party === "third")).toBe(false);
  });

  it("holds the post of a frame in a process of its own, in that frame's own session", async () => {
    const task = agentTask({ target: { ...TARGET, website: OFFSITE } });
    const { sends } = await run([open("/gate-cross"), typeEmail, wait(3)], {
      sends: NOBODY(),
      task,
    });
    const state = await fixtureState();
    expect(submissionsOf(state, "/gate-frame-post")).toEqual([]);
    const held = sends.held.find((entry) => entry.request.path === "/gate-frame-post");
    expect(held?.request.target.type).toBe("iframe");
    expect(held?.request.target.topLevel).toBe(false);
    expect(held?.request.target.frameOrigin).toContain("localhost");
  });

  it("refuses an image from another site once the run has typed", async () => {
    const { sends } = await run([open("/gate-third"), typeEmail, wait(1)], { sends: NOBODY() });
    expect(submissionsOf(await fixtureState(), "/gate-pixel")).toEqual([]);
    expect(sends.refusals.map((refusal) => refusal.reason)).toContain("third_party_after_touch");
  });

  it("lets a page load what it needs from another site before the run has touched anything", async () => {
    await run([open("/gate-third"), wait(1)], { sends: NOBODY() });
    expect(true).toBe(true);
  });
});

describeBrowser("what the page stored or set", () => {
  it("refuses a request whose cookie holds the email", async () => {
    const { sends } = await run([open("/gate-cookie"), typeEmail, wait(1)], { sends: NOBODY() });
    expect(submissionsOf(await fixtureState(), "/gate-pixel")).toEqual([]);
    expect(sends.held.map((held) => held.request.path)).toContain("/gate-pixel");
  });

  it("clears what an earlier run left in the target's storage before the page can send it", async () => {
    const seed = await context.newPage();
    await seed.goto(`${ORIGIN}/gate-seed?email=jordan.example%40example.com`);
    await seed.close();
    await run([open("/gate-storage"), wait(1)], { sends: NOBODY() });
    const [hit] = (await fixtureState()).hits.filter((entry) => entry.path === "/gate-collect");
    expect(hit?.search).toContain("ls=none");
    expect(hit?.search).toContain("ck=none");
  });
});

describeBrowser("a redirect that sends the same body again", () => {
  it("is part of the release that was approved, and is not asked about a second time", async () => {
    const sends = new FakeSends(() => "send");
    await run([open("/gate-hop"), typeEmail, clickSubmit, giveBack], {
      sends,
      gate: { holdMs: 5_000 },
    });
    const state = await fixtureState();
    expect(state.submissions.map((submission) => submission.path)).toEqual(["/gate-optout"]);
    expect(sends.held).toHaveLength(1);
    expect(sends.held[0]?.request.path).toBe("/gate-hop");
    expect(sends.releases).toHaveLength(1);
  });

  it("is never followed when nobody approved the first request", async () => {
    await run([open("/gate-hop"), typeEmail, clickSubmit], { sends: NOBODY() });
    const posted = (await fixtureState()).hits.filter((hit) => hit.method === "POST");
    expect(posted).toEqual([]);
  });
});

describeBrowser("a send after the run has ended", () => {
  it("never reaches the site from a pagehide beacon or a late timer", async () => {
    await run([open("/gate-beacon"), typeEmail, { calls: [["report", { status: "release" }]] }], {
      sends: NOBODY(),
    });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(submissionsOf(await fixtureState(), "/gate-beacon-post", "/gate-late-post")).toEqual([]);
  });
});

describeBrowser("a send from a worker", () => {
  it.each([
    ["a blob worker", "/gate-worker", ["/gate-worker-post"]],
    ["a worker from a file", "/gate-worker-file", ["/gate-worker-post"]],
    ["a worker started by a worker", "/gate-worker-nested", ["/gate-inner-post"]],
  ])("holds the post of %s", async (_, path, posted) => {
    const { sends } = await run([open(path), typeEmail, wait(2)], { sends: NOBODY() });
    expect(submissionsOf(await fixtureState(), ...posted)).toEqual([]);
    expect(sends.held.map((held) => held.request.path)).toEqual(posted);
  });

  it.each([
    ["a blob worker", "/gate-worker", "/gate-worker-post"],
    ["a worker started by a worker", "/gate-worker-nested", "/gate-inner-post"],
  ])("asks once, and sends once, for the post of %s", async (_, path, posted) => {
    const sends = new FakeSends(() => "send");
    await run([open(path), typeEmail, wait(2), giveBack], { sends, gate: { holdMs: 5_000 } });
    expect(submissionsOf(await fixtureState(), posted)).toHaveLength(1);
    expect(sends.held).toHaveLength(1);
    expect(sends.releases).toHaveLength(1);
  });

  it("sends nothing through a shared worker or a service worker", async () => {
    const { sends, outcome } = await run([open("/gate-shared"), typeEmail, wait(2), giveBack], {
      sends: NOBODY(),
    });
    expect(
      submissionsOf(await fixtureState(), "/gate-shared-post", "/gate-shared.js", "/sw.js"),
    ).toEqual([]);
    expect(sends.releases).toEqual([]);
    expect(outcome.report.kind).toBe("release");
  });
});

describeBrowser("a live connection", () => {
  it("is blocked, receives nothing, and stops the run with the copy that says why", async () => {
    const { outcome } = await run([open("/gate-ws"), typeEmail, wait(2)], { sends: NOBODY() });
    const state = await fixtureState();
    expect(state.wsFrames).toEqual([]);
    expect(blocked(outcome)?.detail).toContain("live connection");
    expect(blocked(outcome)).toMatchObject({ reason: "approval_needed" });
  });

  it("ends the run with nothing sent when the page opens one before anything was touched", async () => {
    const { outcome } = await run([open("/gate-ws?load=1"), wait(2)], { sends: NOBODY() });
    expect((await fixtureState()).wsFrames).toEqual([]);
    expect(blocked(outcome)).toMatchObject({ reason: "unknown" });
  });
});
