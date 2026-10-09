import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_ROUTES, type SendRow } from "@kickrocks/shared";
import { BROWSER_CONTEXT_OPTIONS } from "@kickrocks/worker/dist/browser.js";
import { createLogger } from "@kickrocks/worker/dist/logger.js";
import type { Browser, BrowserContext } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestContext,
  seedMailbox,
  seedProfile,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../../server/src/test-utils/index.js";
import type { AgentWorkerConfig } from "../src/config.js";
import { runAgentWorker } from "../src/worker.js";
import { ORIGIN } from "./fixtures/server.js";
import {
  describeBrowser,
  fixtureState,
  launchTestBrowser,
  resetFixture,
  type Step,
  scripted,
} from "./support.js";

vi.setConfig({ testTimeout: 120_000 });

const debugLogger = createLogger(process.env.GATE_LOG === "1" ? "debug" : "error");
/** Long enough that a person (the test) can answer, short enough that a lapse is quick. */
const ANSWER_MS = 30_000;
const LAPSE_MS = 1_200;

/** Set once the server listens, on a port the operating system picked so no run needs one free. */
let serverUrl = "";
/** The browser context of the run in progress, for a test that has to look at its tabs. */
let runContext: BrowserContext | null = null;
let browser: Browser;
let ctx: TestContext;
let profileDir: string;

beforeAll(async () => {
  browser = await launchTestBrowser();
});
afterAll(async () => {
  await browser.close();
});
beforeEach(async () => {
  profileDir = mkdtempSync(join(tmpdir(), "kickrocks-gate-"));
  await resetFixture();
});
afterEach(async () => {
  await ctx?.app.close().catch(() => undefined);
  await ctx?.close().catch(() => undefined);
  rmSync(profileDir, { recursive: true, force: true });
});

function config(): AgentWorkerConfig {
  return {
    serverUrl,
    token: ctx.workerToken,
    workerId: "gate-agent",
    pollMs: 20,
    leaseMs: 60_000,
    provider: {
      kind: "openai",
      model: "uncleared-model",
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: null,
      maxOutputTokens: 1024,
      tokenParam: "max_tokens",
      numCtx: 16_384,
      thinking: "default",
    },
    pricing: null,
    limits: { maxSteps: 30, maxMs: 60_000, maxTotalTokens: null },
    chromeProfileDir: profileDir,
    headless: true,
    noSandbox: false,
    allowHttp: true,
    pace: "instant",
    chromeExecutable: null,
    logLevel: "error",
  } as AgentWorkerConfig;
}

/** Queues one removal whose opt-out page is `path` on the fixture site. */
async function startServer(path = "/gate-form", twoHosts = false): Promise<string> {
  ctx = await createTestContext();
  const profileId = seedProfile(ctx).id;
  seedMailbox(ctx, profileId);
  const target = seedTarget(ctx, {
    contactMethod: "form",
    category: "marketing",
    domain: "127.0.0.1",
    optOutUrl: `${ORIGIN}${path}`,
    website: twoHosts ? `http://localhost:${new URL(ORIGIN).port}/` : `${ORIGIN}/`,
  });
  const request = seedRequest(ctx, {
    profileId,
    targetId: target.id,
    status: "queued",
    channel: "form",
  });
  ctx.services.dispatch.dispatchRequest(request.id);
  serverUrl = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  const task = ctx.services.taskQueue
    .list({ kinds: ["agent"], status: "queued" })
    .find((t) => t.kind === "agent");
  if (!task) throw new Error("no agent task was queued");
  return task.id;
}

interface WorkOptions {
  /** How long a held send waits for the person before the run gives up on it. */
  holdMs?: number;
  maxScreenshotBytes?: number;
}

/** Runs the real agent worker against the real server until the task leaves the lease. */
async function workOnce(taskId: string, steps: Step[], options: WorkOptions = {}) {
  const controller = new AbortController();
  const claimed = vi.fn();
  const finished = runAgentWorker({
    config: config(),
    signal: controller.signal,
    logger: debugLogger,
    provider: scripted(steps),
    launcher: async () => {
      runContext = await browser.newContext(BROWSER_CONTEXT_OPTIONS);
      return runContext;
    },
    timing: {
      idleHeartbeatMs: 10_000,
      leaseHeartbeatMs: 1_000,
      reportRetryMs: 1,
      shutdownGraceMs: 300,
    },
    challengeGraceMs: 200,
    holdMsCap: options.holdMs ?? LAPSE_MS,
    ...(options.maxScreenshotBytes === undefined
      ? {}
      : { maxScreenshotBytes: options.maxScreenshotBytes }),
  });
  await vi.waitUntil(
    () => {
      const status = ctx.services.taskQueue.getOrThrow(taskId).status;
      if (status === "leased") claimed();
      return claimed.mock.calls.length > 0 && status !== "leased";
    },
    { timeout: 90_000, interval: 25 },
  );
  controller.abort();
  await finished;
  return ctx.services.taskQueue.getOrThrow(taskId);
}

type Answer = "send" | "dont_send" | "nobody";

/**
 * Answers the requests a run holds, one answer for each, through the same route the review page
 * uses. `nobody` leaves a request alone so that it lapses.
 */
async function answerHolds(taskId: string, answers: Answer[]): Promise<void> {
  const handled = new Set<string>();
  for (const answer of answers) {
    let held: SendRow | undefined;
    await vi.waitUntil(
      () => {
        held = ctx.services.taskSends
          .list(taskId)
          .sends.find(
            (row) => row.kind === "held" && row.status === "pending_live" && !handled.has(row.id),
          );
        return held !== undefined;
      },
      { timeout: 60_000, interval: 25 },
    );
    const row = held as SendRow;
    handled.add(row.id);
    if (answer === "nobody") continue;
    const decided = await decideRow(taskId, row.id, answer);
    expect(decided.status).toBe(200);
  }
}

function decideRow(taskId: string, sendId: string, decision: "send" | "dont_send") {
  return ctx.call(API_ROUTES.taskSendDecide, {
    params: { id: taskId, sendId },
    body: { decision },
  });
}

function approveNext(taskId: string, declineSendIds: string[] = []) {
  return ctx.call(API_ROUTES.taskApproveSubmit, {
    params: { id: taskId },
    body: { declineSendIds },
  });
}

const rowsOf = (taskId: string) => ctx.services.taskSends.list(taskId).sends;
const releasedOf = (taskId: string) => rowsOf(taskId).filter((row) => row.kind === "released");

const open = (path: string): Step => ({ calls: [["navigate", { url: `${ORIGIN}${path}` }]] });
const fill: Step = (v) => ({
  calls: [
    ["type", { ref: v.ref("First name"), field: "first_name" }],
    ["type", { ref: v.ref("Last name"), field: "last_name" }],
    ["type", { ref: v.ref("Email address"), field: "email" }],
  ],
});
const typeEmail: Step = (v) => ({
  calls: [["type", { ref: v.ref("Email address"), field: "email" }]],
});
const chooseDelete: Step = (v) => ({
  calls: [["select", { ref: v.ref("Request type"), option: "Delete my data" }]],
});
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
const wait = (seconds: number): Step => ({ calls: [["wait", { seconds }]] });
const report: Step = {
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

const submitSteps = (...before: Step[]): Step[] => [
  open("/gate-form"),
  fill,
  chooseDelete,
  snap,
  ...before,
  clickLabel("Submit request"),
];

async function firstLapse(taskId: string, steps: Step[] = submitSteps()) {
  return workOnce(taskId, steps);
}

describeBrowser("the outgoing gate end to end with the real server", () => {
  describe("a baseline run", () => {
    it("holds the form, sends exactly the request that was captured once a person says send, and finishes", async () => {
      const taskId = await startServer();
      const answered = answerHolds(taskId, ["send"]);
      const done = await workOnce(taskId, [...submitSteps(), report], { holdMs: ANSWER_MS });
      await answered;

      expect(done).toMatchObject({
        status: "done",
        mayHaveSubmitted: true,
        submitApproval: "required",
      });
      const { submissions } = await fixtureState();
      expect(submissions).toHaveLength(1);
      expect(submissions[0]).toMatchObject({
        path: "/gate-optout",
        fields: {
          kind: "delete",
          action: "optout",
          share: "no",
          scope: "this-site",
          email: "jordan@example.com",
        },
      });
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(held).toHaveLength(1);
      expect(held[0]).toMatchObject({ status: "sent", decidedBy: "user", hasScreenshot: true });
      const released = releasedOf(taskId);
      expect(released).toHaveLength(1);
      expect(released[0]).toMatchObject({ status: "sent", responseStatus: 200 });
      const request = released[0]?.request;
      expect(
        request && "body" in request ? request.body.map((value) => value.path).sort() : [],
      ).toEqual(Object.keys(submissions[0]?.fields ?? {}).sort());
    });

    it("shows the person's values in a held request where the page was given them", async () => {
      const taskId = await startServer();
      const answered = answerHolds(taskId, ["dont_send"]);
      const done = await workOnce(taskId, [...submitSteps(), giveBack], { holdMs: ANSWER_MS });
      await answered;
      expect(done.status).not.toBe("done");
      const log = await ctx.call(API_ROUTES.taskSends, { params: { id: taskId } });
      expect(log.ok && log.body.values["{{email}}"]).toBe("jordan@example.com");
      expect((await fixtureState()).submissions).toEqual([]);
    });

    it("lets the run lapse when nobody is home, then sends the approved request once in the next run", async () => {
      const taskId = await startServer();
      const first = await firstLapse(taskId);
      expect(first).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(first.blockedDetail).toContain(
        "any run of six or more characters in a row from an email, phone, street, date of birth or hidden value",
      );
      expect((await fixtureState()).submissions).toEqual([]);
      const waiting = rowsOf(taskId).filter((row) => row.status === "awaiting_next_run");
      expect(waiting).toHaveLength(1);

      expect((await approveNext(taskId)).ok).toBe(true);
      const done = await workOnce(taskId, [...submitSteps(), report]);

      expect(done.status).toBe("done");
      const { submissions } = await fixtureState();
      expect(submissions).toHaveLength(1);
      expect(rowsOf(taskId).find((row) => row.id === waiting[0]?.id)?.status).toBe("spent");
      const released = releasedOf(taskId);
      expect(released).toHaveLength(1);
      expect(released[0]?.spendsSendId).toBe(waiting[0]?.id);
    });

    it("sends nothing in a run that was declined, and the run goes on to report", async () => {
      const taskId = await startServer();
      const answered = answerHolds(taskId, ["dont_send"]);
      const done = await workOnce(taskId, [...submitSteps(), giveBack], { holdMs: ANSWER_MS });
      await answered;
      expect(done.status).toBe("queued");
      expect((await fixtureState()).submissions).toEqual([]);
      expect(rowsOf(taskId).find((row) => row.kind === "held")?.status).toBe("declined");
    });
  });

  describe("a send the page makes on its own", () => {
    it("holds a debounced autosave that fires after the guard window used to have closed", async () => {
      const taskId = await startServer("/gate-delayed");
      const done = await workOnce(taskId, [
        open("/gate-delayed"),
        typeEmail,
        wait(2),
        snap,
        giveBack,
      ]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(held.map((row) => row.status)).toEqual(["awaiting_next_run"]);
      expect(held[0]?.request).toMatchObject({ path: "/gate-autosave", method: "POST" });
    });

    it("sends nothing when the person declines it, and nothing at 0, 1.5 and 10 seconds", async () => {
      const taskId = await startServer("/gate-delayed");
      const answered = answerHolds(taskId, ["dont_send"]);
      await workOnce(taskId, [open("/gate-delayed"), typeEmail, wait(3), giveBack], {
        holdMs: ANSWER_MS,
      });
      await answered;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect((await fixtureState()).submissions).toEqual([]);
    });

    it("does not let a pagehide beacon or a late timer out after an immediate report", async () => {
      const taskId = await startServer("/gate-beacon");
      await workOnce(taskId, [open("/gate-beacon"), typeEmail, giveBack]);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const paths = (await fixtureState()).hits.map((hit) => hit.path);
      expect(paths).not.toContain("/gate-beacon-post");
      expect(paths).not.toContain("/gate-late-post");
    });

    it("holds a form.submit() fired during a wait, and the lapse is never a failure to retry", async () => {
      const taskId = await startServer("/gate-delayed-submit");
      const done = await workOnce(taskId, [open("/gate-delayed-submit"), typeEmail, wait(2), snap]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(done.attempts).toBe(1);
      expect((await fixtureState()).submissions).toEqual([]);
    });
  });

  describe("what the page sends besides a form", () => {
    it("holds a GET fetch and an image, and logs the held ones with the email hidden", async () => {
      const taskId = await startServer("/gate-get");
      const done = await workOnce(taskId, [open("/gate-get"), typeEmail, wait(1), snap, giveBack]);
      expect(done.status).toBe("blocked");
      const state = await fixtureState();
      expect(state.hits.filter((hit) => hit.path === "/gate-collect")).toEqual([]);
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(held.length).toBeGreaterThan(0);
      expect(JSON.stringify(held.map((row) => row.request))).not.toContain("jordan@example.com");
    });

    it("holds a value placed in a query key, a header name or a subdomain label", async () => {
      const taskId = await startServer("/gate-keys", true);
      const done = await workOnce(taskId, [open("/gate-keys"), typeEmail, wait(2), snap, giveBack]);
      expect(done.status).toBe("blocked");
      const state = await fixtureState();
      expect(state.hits.filter((hit) => hit.path === "/gate-collect")).toEqual([]);
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      const requests = held.map((row) => row.request).filter((request) => "query" in request);
      expect(requests.some((r) => r.query.some((entry) => entry.path.includes("{{")))).toBe(true);
      expect(requests.some((r) => r.headers.some((entry) => entry.path.includes("{{")))).toBe(true);
      expect(requests.some((r) => r.host.includes("{{"))).toBe(true);
      expect(requests.some((r) => r.path.includes("{{"))).toBe(true);
      const packed = Buffer.from("jordan@example.com").toString("hex");
      expect(JSON.stringify(held.map((row) => row.request))).not.toContain(packed);
      expect(JSON.stringify(held.map((row) => row.request))).not.toContain("jordan@example.com");
    });

    it("refuses a value sent to another site and never offers it for approval", async () => {
      const taskId = await startServer("/gate-cross", true);
      await workOnce(taskId, [open("/gate-cross"), typeEmail, wait(2), giveBack]);
      expect((await fixtureState()).hits.filter((hit) => hit.host === "other.test")).toEqual([]);
      const refused = rowsOf(taskId).filter((row) => row.kind === "refused");
      expect(refused.map((row) => row.reason)).toContain("third_party_value");
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(held.every((row) => "party" in row.request && row.request.party === "target")).toBe(
        true,
      );
    });

    it("stops with the live connection copy and receives no frame", async () => {
      const taskId = await startServer("/gate-ws");
      const done = await workOnce(taskId, [open("/gate-ws"), typeEmail, wait(2), giveBack]);
      expect((await fixtureState()).wsFrames).toEqual([]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(done.blockedDetail).toContain("live connection");
      expect(done.mayHaveSubmitted).toBe(false);
    });
  });

  describe("channels the page can use besides a form", () => {
    it("holds a post made by a blob worker, and sends it once when the person says send", async () => {
      const taskId = await startServer("/gate-worker");
      const answered = answerHolds(taskId, ["send"]);
      await workOnce(taskId, [open("/gate-worker"), typeEmail, wait(2), giveBack], {
        holdMs: ANSWER_MS,
      });
      await answered;
      const posts = (await fixtureState()).hits.filter((hit) => hit.path === "/gate-worker-post");
      expect(posts).toHaveLength(1);
      expect(releasedOf(taskId)).toHaveLength(1);
    });

    it("sends nothing through a nested worker, a shared worker or a service worker", async () => {
      const nested = await startServer("/gate-worker-nested");
      await workOnce(nested, [open("/gate-worker-nested"), typeEmail, wait(2), giveBack]);
      expect((await fixtureState()).hits.map((hit) => hit.path)).not.toContain("/gate-inner-post");
      await ctx.app.close();
      await ctx.close();
      await resetFixture();
      const shared = await startServer("/gate-shared");
      await workOnce(shared, [open("/gate-shared"), typeEmail, wait(2), giveBack]);
      const paths = (await fixtureState()).hits.map((hit) => hit.path);
      expect(paths).not.toContain("/gate-shared-post");
      expect(paths).not.toContain("/sw.js");
    });

    it("sends nothing through a stylesheet, a font, a srcdoc frame, a refresh, a blank-target form, an event stream or a beacon, and refuses the beacon instead of holding it", async () => {
      const taskId = await startServer("/gate-probes");
      await workOnce(taskId, [open("/gate-probes"), typeEmail, wait(2), giveBack]);
      const probes = (await fixtureState()).hits.filter((hit) =>
        hit.path.startsWith("/gate-probe-"),
      );
      expect(probes).toEqual([]);
      const heldPaths = rowsOf(taskId)
        .filter((row) => row.kind === "held")
        .map((row) => ("path" in row.request ? row.request.path : ""));
      for (const probe of ["css", "font", "srcdoc", "refresh", "sse"]) {
        expect(heldPaths.some((path) => path.includes(`/gate-probe-${probe}`))).toBe(true);
      }
      expect(heldPaths.some((path) => path.includes("/gate-probe-beacon"))).toBe(false);
      expect(
        rowsOf(taskId).some(
          (row) =>
            row.kind === "refused" &&
            row.reason === "not_holdable" &&
            "path" in row.request &&
            row.request.path.includes("/gate-probe-beacon"),
        ),
      ).toBe(true);
      expect(JSON.stringify(rowsOf(taskId).map((row) => row.request))).not.toContain(
        "jordan@example.com",
      );
    });

    it("refuses a value however the page packs it, and holds the unpacked ones", async () => {
      const taskId = await startServer("/gate-encode");
      await workOnce(taskId, [open("/gate-encode"), typeEmail, wait(2), giveBack]);
      const paths = (await fixtureState()).hits.map((hit) => hit.path);
      expect(paths).not.toContain("/gate-gzip-post");
      expect(paths).not.toContain("/gate-pixel");
      const rows = rowsOf(taskId);
      expect(rows.filter((row) => row.kind === "refused").map((row) => row.reason)).toContain(
        "third_party_value",
      );
      expect(JSON.stringify(rows.map((row) => row.request))).not.toContain("jordan@example.com");
    });

    it("holds a form navigation and a location change that carry the email", async () => {
      const taskId = await startServer("/gate-nav");
      await workOnce(taskId, [
        open("/gate-nav"),
        typeEmail,
        (v) => ({ calls: [["click", { ref: v.ref("Go to results") }]] }),
      ]);
      expect((await fixtureState()).hits.map((hit) => hit.path)).not.toContain("/gate-collect");
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(held).toHaveLength(1);
      expect(held[0]?.request).toMatchObject({
        method: "GET",
        path: "/gate-collect",
        isDocument: true,
      });
    });

    it("follows a redirect that sends the same body again as part of the one release", async () => {
      const taskId = await startServer("/gate-hop");
      const answered = answerHolds(taskId, ["send"]);
      const done = await workOnce(
        taskId,
        [open("/gate-hop"), typeEmail, snap, clickLabel("Submit request"), report],
        { holdMs: ANSWER_MS },
      );
      await answered;
      expect(done.status).toBe("done");
      const { submissions } = await fixtureState();
      expect(submissions.map((submission) => submission.path)).toEqual(["/gate-optout"]);
      expect(rowsOf(taskId).filter((row) => row.kind === "held")).toHaveLength(1);
    });
  });

  describe("a window the page opens", () => {
    it("receives nothing the page posts through its handle", async () => {
      const taskId = await startServer("/gate-popup");
      await workOnce(taskId, [open("/gate-popup"), typeEmail, wait(2), giveBack]);
      const paths = (await fixtureState()).hits.map((hit) => hit.path);
      expect(paths).not.toContain("/gate-popup-post");
      expect(paths).not.toContain("/gate-popup-beacon");
      expect(paths).not.toContain("/gate-popup-blank");
    });
  });

  describe("channels nobody had probed", () => {
    it.each([
      ["an event source", "/gate-sse"],
      ["a meta refresh", "/gate-refresh"],
      ["a form aimed at a new tab", "/gate-blank-form"],
      ["a post that is answered with a 303", "/gate-see-other"],
      ["a state change of the address bar", "/gate-push-state"],
    ])("lets %s carry nothing of the email to the site", async (_, path) => {
      const taskId = await startServer(path);
      await workOnce(taskId, [open(path), typeEmail, wait(2), giveBack]);
      const { hits, submissions } = await fixtureState();
      const leaked = hits.filter((hit) =>
        `${hit.path} ${hit.search} ${hit.body}`.toLowerCase().includes("jordan"),
      );
      expect(leaked).toEqual([]);
      expect(submissions).toEqual([]);
    });
  });

  describe("the browser's own preloading, which makes requests outside the request gate", () => {
    it("runs in a Chrome whose preloading setting is off", async () => {
      const own = browser.contexts()[0];
      const page = own?.pages()[0] ?? (await own?.newPage());
      await page?.goto("chrome://prefs-internals");
      const text = String(await page?.evaluate("document.body.innerText"));
      const prefs = JSON.parse(text.slice(text.indexOf("{")));
      expect(prefs.net.network_prediction_options.value).toBe(2);
    });

    it.each([
      ["list rules that prefetch the address with the email at once", "/gate-spec-prefetch"],
      ["list rules that prerender the address with the email at once", "/gate-spec-prerender"],
    ])("sends nothing for %s", async (_, path) => {
      const taskId = await startServer(path);
      await workOnce(taskId, [open(path), typeEmail, wait(2), giveBack]);
      const { hits, submissions } = await fixtureState();
      expect(hits.filter((hit) => hit.path === "/gate-landing")).toEqual([]);
      expect(submissions).toEqual([]);
    });

    it.each([
      ["document rules like a WordPress site ships", "/gate-spec-document"],
      ["a Speculation-Rules header", "/gate-spec-header"],
    ])("sends nothing for %s and holds the click on a link with the email", async (_, path) => {
      const taskId = await startServer(path);
      await workOnce(taskId, [
        open(path),
        typeEmail,
        wait(2),
        snap,
        clickLabel("Continue"),
        wait(1),
        giveBack,
      ]);
      const { hits, submissions } = await fixtureState();
      expect(hits.filter((hit) => hit.path === "/gate-landing")).toEqual([]);
      expect(submissions).toEqual([]);
      expect(rowsOf(taskId).filter((row) => row.kind === "held")).toHaveLength(1);
    });
  });

  describe("what the browser attaches after the gate has read a request", () => {
    it("cuts the Referer of a later load to the site address after the page wrote the email into its own address", async () => {
      const taskId = await startServer("/gate-referer");
      await workOnce(taskId, [open("/gate-referer"), typeEmail, wait(2), giveBack]);
      const { hits } = await fixtureState();
      const pixel = hits.filter((hit) => hit.path === "/gate-pixel");
      expect(pixel).toHaveLength(1);
      expect(pixel[0]?.referer).toBe(`${ORIGIN}/`);
      expect(
        hits
          .map((hit) => hit.referer)
          .join(" ")
          .toLowerCase(),
      ).not.toContain("jordan");
      const noted = rowsOf(taskId).filter(
        (row) => row.kind === "guard_event" && row.reason === "referer_cut",
      );
      expect(noted.length).toBeGreaterThan(0);
    });

    it("refuses an approved send when the page set a cookie while it was held", async () => {
      const taskId = await startServer("/gate-cookie-hold");
      const answered = (async () => {
        await vi.waitUntil(
          () => rowsOf(taskId).some((row) => row.kind === "held" && row.status === "pending_live"),
          { timeout: 60_000, interval: 25 },
        );
        await vi.waitUntil(
          async () => (await runContext?.cookies())?.some((cookie) => cookie.name === "late"),
          { timeout: 30_000, interval: 25 },
        );
        const held = rowsOf(taskId).find((row) => row.kind === "held");
        expect((await decideRow(taskId, held?.id ?? "", "send")).status).toBe(200);
      })();
      await workOnce(
        taskId,
        [
          open("/gate-cookie-hold"),
          typeEmail,
          snap,
          clickLabel("Submit request"),
          wait(1),
          giveBack,
        ],
        { holdMs: ANSWER_MS },
      );
      await answered;
      const { hits, submissions } = await fixtureState();
      expect(submissions).toEqual([]);
      expect(hits.filter((hit) => hit.cookie.includes("late"))).toEqual([]);
      expect(
        rowsOf(taskId).some((row) => row.kind === "refused" && row.reason === "cookies_changed"),
      ).toBe(true);
      expect(releasedOf(taskId).every((row) => row.status !== "sent")).toBe(true);
    });
  });

  describe("a radio group with long values", () => {
    const chooseScope =
      (label: string): Step =>
      (v) => ({
        calls: [["check", { ref: v.ref(label), checked: true }]],
      });
    const submit = (label: string): Step[] => [
      open("/gate-scope"),
      typeEmail,
      chooseScope(label),
      snap,
      clickLabel("Submit request"),
    ];

    it("is not approved for another option of the group in the next run", async () => {
      const taskId = await startServer("/gate-scope");
      await workOnce(taskId, submit("Suppress marketing only"));
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(JSON.stringify(held.map((row) => row.request))).not.toContain("served_token");
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [...submit("Share with partner brands"), giveBack]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
    });

    it("is sent when the next run picks the option the person saw", async () => {
      const taskId = await startServer("/gate-scope");
      await workOnce(taskId, submit("Suppress marketing only"));
      expect((await approveNext(taskId)).ok).toBe(true);
      const done = await workOnce(taskId, [...submit("Suppress marketing only"), report]);
      expect(done.status).toBe("done");
      const { submissions } = await fixtureState();
      expect(submissions).toHaveLength(1);
      expect(submissions[0]?.fields.scope).toBe("suppress_marketing_only_please");
    });
  });

  describe("the same-label second form", () => {
    it("is not approved by the approval of the first form", async () => {
      const taskId = await startServer();
      await firstLapse(taskId);
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [
        ...submitSteps().slice(0, -1),
        clickLabel("Submit request", 1),
        giveBack,
      ]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      const { submissions } = await fixtureState();
      expect(submissions.filter((submission) => submission.path === "/gate-newsletter")).toEqual(
        [],
      );
      expect(submissions).toEqual([]);
    });
  });

  describe("a run that differs from what was approved", () => {
    it.each([
      [
        "a different option",
        [
          (v: { ref: (l: string) => string }) => ({
            calls: [["select", { ref: v.ref("Request type"), option: "Access my data" }]],
          }),
        ],
      ],
      [
        "an extra tick",
        [
          (v: { ref: (l: string) => string }) => ({
            calls: [["check", { ref: v.ref("Send me offers"), checked: true }]],
          }),
        ],
      ],
    ])("is held again for %s", async (_, extra) => {
      const taskId = await startServer();
      await firstLapse(taskId);
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [
        open("/gate-form"),
        fill,
        chooseDelete,
        ...(extra as Step[]),
        snap,
        clickLabel("Submit request"),
        giveBack,
      ]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
    });

    it.each([
      ["a div role=checkbox", "Share my details with partners"],
      ["a type=button toggle", "Include partner brands"],
      ["a role=switch", "Send me alerts"],
      ["an aria-pressed button", "Pin my listing"],
      ["a label that acts like a button", "Sync my other accounts"],
      ["a tab", "Advanced options"],
    ])("is held again when %s flips a hidden field", async (_, control) => {
      const taskId = await startServer("/gate-custom");
      await workOnce(taskId, [open("/gate-custom"), typeEmail, snap, clickLabel("Submit request")]);
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [
        open("/gate-custom"),
        snap,
        clickLabel(control),
        typeEmail,
        snap,
        clickLabel("Submit request"),
        giveBack,
      ]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
    });
  });

  describe("a request with more fields than are listed", () => {
    it("is not sent on an approval of the shorter one when the next run adds a phone past the listed fields", async () => {
      const taskId = await startServer("/gate-overflow");
      await workOnce(taskId, [
        open("/gate-overflow"),
        typeEmail,
        snap,
        clickLabel("Submit request"),
      ]);
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [
        open("/gate-overflow#phone"),
        typeEmail,
        (v) => ({ calls: [["type", { ref: v.ref("Phone number"), field: "phone" }]] }),
        snap,
        clickLabel("Submit request"),
        giveBack,
      ]);
      expect(after.status).not.toBe("done");
      expect((await fixtureState()).submissions).toEqual([]);
      expect(rowsOf(taskId).some((row) => row.kind === "refused")).toBe(true);
    });
  });

  describe("tokens the site changes on every load", () => {
    it("matches a replay whose per-load token differs, and sends it once", async () => {
      const taskId = await startServer("/gate-csrf");
      const steps = [open("/gate-csrf"), typeEmail, snap, clickLabel("Submit request")];
      await workOnce(taskId, steps);
      expect((await approveNext(taskId)).ok).toBe(true);
      const done = await workOnce(taskId, [...steps, report]);
      expect(done.status).toBe("done");
      const { submissions } = await fixtureState();
      expect(submissions).toHaveLength(1);
      expect(submissions[0]?.fields.csrf).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    });

    it("holds a long random value that a click set, which the site did not serve", async () => {
      const taskId = await startServer("/gate-csrf");
      await workOnce(taskId, [open("/gate-csrf"), typeEmail, snap, clickLabel("Submit request")]);
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [
        open("/gate-csrf"),
        typeEmail,
        snap,
        clickLabel("Prepare request"),
        clickLabel("Submit request"),
        giveBack,
      ]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
    });
  });

  describe("a form with two steps", () => {
    const steps = (): Step[] => [
      open("/gate-step1"),
      typeEmail,
      snap,
      clickLabel("Continue"),
      snap,
      clickLabel("Confirm removal"),
    ];

    it("asks for each step in the same run and finishes after both are approved", async () => {
      const taskId = await startServer("/gate-step1");
      const answered = answerHolds(taskId, ["send", "send"]);
      const done = await workOnce(taskId, [...steps(), report], { holdMs: ANSWER_MS });
      await answered;
      expect(done.status).toBe("done");
      const { submissions } = await fixtureState();
      expect(submissions.map((submission) => submission.path)).toEqual([
        "/gate-step1-post",
        "/gate-step2-post",
      ]);
      expect(releasedOf(taskId)).toHaveLength(2);
    });

    it("sends step 1 again, then step 2, when the run lapsed at step 2 and the next run is approved", async () => {
      const taskId = await startServer("/gate-step1");
      const answered = answerHolds(taskId, ["send", "nobody"]);
      const first = await workOnce(taskId, steps(), { holdMs: 4_000 });
      await answered;
      expect(first).toMatchObject({
        status: "blocked",
        blockedReason: "approval_needed",
        mayHaveSubmitted: true,
      });
      expect((await fixtureState()).submissions.map((s) => s.path)).toEqual(["/gate-step1-post"]);

      expect((await approveNext(taskId)).ok).toBe(true);
      const log = ctx.services.taskSends.gateFor(taskId);
      expect(log.approved.map((entry) => [entry.request.path, entry.resend])).toEqual([
        ["/gate-step1-post", true],
        ["/gate-step2-post", false],
      ]);

      const done = await workOnce(taskId, [...steps(), report]);
      expect(done.status).toBe("done");
      expect((await fixtureState()).submissions.map((s) => s.path)).toEqual([
        "/gate-step1-post",
        "/gate-step1-post",
        "/gate-step2-post",
      ]);
    });
  });

  describe("one page, one way out for the email", () => {
    const heldPaths = (taskId: string) =>
      rowsOf(taskId)
        .filter((row) => row.kind === "held")
        .map((row) => ("path" in row.request ? row.request.path : ""));

    const carriedBy = (taskId: string, path: string) =>
      rowsOf(taskId).flatMap((row) =>
        row.kind === "held" && "path" in row.request && row.request.path === path
          ? row.request.carries
          : [],
      );

    /** Nothing the vector page asked of the site reached it, whatever it carried. */
    async function expectNothingArrived(): Promise<void> {
      const { hits, submissions } = await fixtureState();
      expect(hits.filter((hit) => hit.path.startsWith("/gate-v-"))).toEqual([]);
      expect(submissions).toEqual([]);
    }

    async function stopsForApproval(vector: string, steps: Step[]) {
      const taskId = await startServer(`/gate-vectors#${vector}`);
      const done = await workOnce(taskId, [open(`/gate-vectors#${vector}`), ...steps]);
      await expectNothingArrived();
      return { taskId, done };
    }

    it.each([
      ["css", "a background image set from script", "/gate-v-css"],
      ["font", "a web font loaded from script", "/gate-v-font"],
      ["eventsource", "an event stream", "/gate-v-sse"],
      ["refresh", "a meta refresh to an address with the value", "/gate-v-refresh"],
      ["pushstate", "a pushState followed by a reload", "/gate-v-push"],
      ["srcdoc", "a srcdoc frame that posts", "/gate-v-srcdoc"],
      ["timer", "a fetch five seconds after typing", "/gate-v-timer"],
    ])("stops for approval at %s: %s", async (vector, _, path) => {
      const { taskId, done } = await stopsForApproval(vector, [
        typeEmail,
        wait(vector === "timer" ? 7 : 2),
        snap,
        giveBack,
      ]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(heldPaths(taskId)).toContain(path);
      expect(JSON.stringify(rowsOf(taskId).map((row) => row.request))).not.toContain(
        "jordan@example.com",
      );
    });

    it("opens no new tab for a form aimed at one, so the post is never made and nothing is asked", async () => {
      const taskId = await startServer("/gate-vectors#blank");
      let transcript = "";
      let after = 0;
      let before = 0;
      const done = await workOnce(taskId, [
        open("/gate-vectors#blank"),
        () => {
          before = runContext?.pages().length ?? 0;
          return { calls: [["snapshot", {}]] };
        },
        typeEmail,
        wait(2),
        wait(2),
        (view) => {
          transcript = view.transcript;
          after = runContext?.pages().length ?? 0;
          return giveBack;
        },
      ]);
      // The script appends its form just before submitting it, so the field is proof it ran that far.
      expect(transcript).toContain(`textbox "e"`);
      // The refused tab is reported, so the submit did ask for one, and no page is left beside the ones the run began with.
      expect(transcript).toContain("Blocked a navigation: A new tab or window cannot be opened");
      expect(after).toBe(before);
      await expectNothingArrived();
      expect(done.status).toBe("queued");
      expect(rowsOf(taskId).filter((row) => row.kind === "held")).toEqual([]);
    });

    it("stops a beacon sent on pagehide, which only goes out as the run ends", async () => {
      const taskId = await startServer("/gate-vectors#pagehide");
      await workOnce(taskId, [open("/gate-vectors#pagehide"), typeEmail, giveBack]);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await expectNothingArrived();
      const rows = rowsOf(taskId).filter(
        (row) => "path" in row.request && row.request.path === "/gate-v-pagehide",
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.kind === "held" || row.kind === "refused")).toBe(true);
    });

    // The profile's hidden first and last names are substrings of the email, so a request is held for
    // them whether or not the gate recognises the email. Only the carried field shows which one did it.
    it.each([
      { vector: "trimmed", how: "with spaces around it" },
      { vector: "lowercased", how: "in capitals" },
      { vector: "base64", how: "as base64" },
      { vector: "reversed", how: "written backwards" },
      { vector: "sha256", how: "as a sha256 hash" },
    ])("stops for approval, as the email, when the value is sent $how", async ({ vector }) => {
      const { taskId, done } = await stopsForApproval(vector, [typeEmail, wait(2), snap, giveBack]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(carriedBy(taskId, `/gate-v-${vector}`)).toContain("email");
    });

    it("refuses an image GET that follows 101 cookies, the last of which holds the email", async () => {
      const taskId = await startServer("/gate-vectors#cookies");
      const done = await workOnce(taskId, [
        open("/gate-vectors#cookies"),
        typeEmail,
        wait(2),
        snap,
        giveBack,
      ]);
      expect(done.status).not.toBe("done");
      await expectNothingArrived();
      const rows = rowsOf(taskId).filter(
        (row) => "path" in row.request && row.request.path === "/gate-v-cookies",
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.kind === "refused")).toBe(true);
    });

    it("stops for approval, as the email, when it is base64 after 64 decoy tokens", async () => {
      const { taskId, done } = await stopsForApproval("tokens", [
        typeEmail,
        wait(2),
        snap,
        giveBack,
      ]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(carriedBy(taskId, "/gate-v-tokens")).toContain("email");
    });

    // The gate does not put the halves back together, but the domain half holds a run of the address.
    it("stops for approval, as an email, when the value is sent split at the @ into two fields", async () => {
      const { taskId, done } = await stopsForApproval("split", [
        typeEmail,
        wait(2),
        snap,
        giveBack,
      ]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(carriedBy(taskId, "/gate-v-split")).toEqual(["email", "other"]);
    });
  });

  describe("a value cut into pieces", () => {
    it("holds an email sent as three pieces in one GET, and nothing arrives", async () => {
      const taskId = await startServer("/gate-vectors#pieces");
      const done = await workOnce(taskId, [
        open("/gate-vectors#pieces"),
        typeEmail,
        wait(2),
        snap,
        giveBack,
      ]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      const { hits, submissions } = await fixtureState();
      expect(hits.filter((hit) => hit.path.startsWith("/gate-v-"))).toEqual([]);
      expect(submissions).toEqual([]);
      const carried = rowsOf(taskId).flatMap((row) =>
        row.kind === "held" && "path" in row.request && row.request.path === "/gate-v-pieces"
          ? row.request.carries
          : [],
      );
      expect(carried).toContain("email");
    });
  });

  describe("a form with two steps that is approved one step at a time", () => {
    it("never sends step 2 on the approval of step 1", async () => {
      const taskId = await startServer("/gate-step1");
      const answered = answerHolds(taskId, ["send", "dont_send"]);
      const done = await workOnce(
        taskId,
        [
          open("/gate-step1"),
          typeEmail,
          snap,
          clickLabel("Continue"),
          snap,
          clickLabel("Confirm removal"),
          giveBack,
        ],
        { holdMs: ANSWER_MS },
      );
      await answered;
      expect(done.status).not.toBe("done");
      expect((await fixtureState()).submissions.map((s) => s.path)).toEqual(["/gate-step1-post"]);
      expect(releasedOf(taskId)).toHaveLength(1);
    });
  });

  describe("a page that changes a field as the form goes out", () => {
    const steps = (): Step[] => [
      open("/gate-mutate"),
      typeEmail,
      snap,
      clickLabel("Submit request"),
    ];

    it("sends what the person was shown when they approve it in the run", async () => {
      const taskId = await startServer("/gate-mutate");
      const answered = answerHolds(taskId, ["send"]);
      await workOnce(taskId, [...steps(), report], { holdMs: ANSWER_MS });
      await answered;
      const { submissions } = await fixtureState();
      expect(submissions).toHaveLength(1);
      const held = rowsOf(taskId).find((row) => row.kind === "held");
      const shown = held && "body" in held.request ? held.request.body : [];
      const shownValue = (path: string) => shown.find((entry) => entry.path === path);
      expect(shownValue("note")).toBeDefined();
      expect(submissions[0]?.fields.note).toBe(shownValue("note")?.value);
      expect(submissions[0]?.fields.email).toBe(
        shownValue("email")?.value.replace("{{email}}", "jordan@example.com"),
      );
    });

    it("holds the replay again when the page changed the field in a way the approval did not cover", async () => {
      const taskId = await startServer("/gate-mutate");
      await workOnce(taskId, steps());
      expect((await approveNext(taskId)).ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const after = await workOnce(taskId, [...steps(), giveBack]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
    });
  });

  describe("the screenshot of a held send", () => {
    function pngHeight(data: Buffer): number {
      return data.readUInt32BE(20);
    }

    it("shows the whole page, with the submit button below the fold", async () => {
      const taskId = await startServer("/gate-long");
      await workOnce(taskId, [open("/gate-long"), typeEmail, snap, clickLabel("Submit request")]);
      const held = rowsOf(taskId).find((row) => row.kind === "held");
      const shot = ctx.services.taskSends.screenshot(taskId, held?.id ?? "");
      expect(shot?.mime).toBe("image/png");
      expect(pngHeight(shot?.data ?? Buffer.alloc(24))).toBeGreaterThan(3_000);
    });

    it("falls back to the part of the page the run acted on when the whole page is too large", async () => {
      const taskId = await startServer("/gate-noisy");
      await workOnce(taskId, [open("/gate-noisy"), typeEmail, snap, clickLabel("Submit request")], {
        maxScreenshotBytes: 400_000,
      });
      const held = rowsOf(taskId).find((row) => row.kind === "held");
      const shot = ctx.services.taskSends.screenshot(taskId, held?.id ?? "");
      expect(shot).not.toBeNull();
      expect(shot?.data.length).toBeLessThanOrEqual(400_000);
      const height = shot?.mime === "image/png" ? pngHeight(shot.data) : 0;
      expect(height).toBeLessThan(1_200);
    });
  });

  describe("a request the browser sends when its session goes away", () => {
    const refusedNotHoldable = (taskId: string, path: string) =>
      rowsOf(taskId).filter(
        (row) =>
          row.kind === "refused" &&
          row.reason === "not_holdable" &&
          "path" in row.request &&
          row.request.path === path,
      );

    async function nothingArrived(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const { hits, submissions } = await fixtureState();
      expect(hits.filter((hit) => hit.path.startsWith("/gate-v-ka-"))).toEqual([]);
      expect(submissions).toEqual([]);
    }

    it("refuses a beacon of a cross-site frame at once, so removing the frame sends nothing", async () => {
      const taskId = await startServer("/gate-keepalive#frame", true);
      await workOnce(taskId, [open("/gate-keepalive#frame"), typeEmail, wait(2), giveBack], {
        holdMs: ANSWER_MS,
      });
      await nothingArrived();
      expect(refusedNotHoldable(taskId, "/gate-v-ka-frame").length).toBeGreaterThan(0);
      expect(rowsOf(taskId).filter((row) => row.kind === "held")).toEqual([]);
    });

    it("refuses a beacon of the top page instead of holding it", async () => {
      const taskId = await startServer("/gate-keepalive#beacon");
      await workOnce(taskId, [open("/gate-keepalive#beacon"), typeEmail, wait(2), giveBack], {
        holdMs: ANSWER_MS,
      });
      await nothingArrived();
      expect(refusedNotHoldable(taskId, "/gate-v-ka-beacon").length).toBeGreaterThan(0);
    });

    it("sends nothing from a keepalive fetch the top page makes as the run closes", async () => {
      const taskId = await startServer("/gate-keepalive#pagehide");
      await workOnce(taskId, [open("/gate-keepalive#pagehide"), typeEmail, giveBack]);
      await nothingArrived();
    });

    for (const vector of ["request", "freshframe", "later"]) {
      it(`makes a keepalive request of the ${vector} kind an ordinary one, so ending the run sends nothing`, async () => {
        const taskId = await startServer(`/gate-keepalive#${vector}`);
        await workOnce(taskId, [open(`/gate-keepalive#${vector}`), typeEmail, wait(2), giveBack], {
          holdMs: ANSWER_MS,
        });
        await nothingArrived();
      });
    }

    it("logs a keepalive fetch that was made an ordinary request", async () => {
      const taskId = await startServer("/gate-keepalive#fetch");
      await workOnce(taskId, [open("/gate-keepalive#fetch"), typeEmail, wait(2), giveBack], {
        holdMs: ANSWER_MS,
      });
      await nothingArrived();
      expect(
        rowsOf(taskId).some((row) => row.kind === "guard_event" && row.reason === "keepalive"),
      ).toBe(true);
    });

    it("sends nothing from a keepalive fetch that was still waiting for a person when the run ended", async () => {
      const taskId = await startServer("/gate-keepalive#fetch");
      await workOnce(taskId, [open("/gate-keepalive#fetch"), typeEmail, wait(2), giveBack], {
        holdMs: ANSWER_MS,
      });
      await nothingArrived();
    });
  });
});
