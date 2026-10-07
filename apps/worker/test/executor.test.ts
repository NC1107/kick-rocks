import type { RunOutcome } from "@kickrocks/recipes";
import { MAX_SCREENSHOT_BYTES } from "@kickrocks/shared";
import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { createExecutor, type Runners, type TaskExecutor } from "../src/executor.js";
import { recipeFor, silentLogger, task } from "./support.js";

const ORIGIN = "http://127.0.0.1:9999";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

function fakePage(url = "https://broker.test/blocked") {
  return { url: () => url, close: vi.fn(async () => undefined) };
}

interface Harness {
  executor: TaskExecutor;
  page: ReturnType<typeof fakePage>;
  runners: { [K in keyof Runners]: ReturnType<typeof vi.fn> };
  openPage: ReturnType<typeof vi.fn>;
}

function harness(outcome: RunOutcome<unknown> | (() => never), pageUrl?: string): Harness {
  const page = fakePage(pageUrl);
  const run = vi.fn(async () => (typeof outcome === "function" ? outcome() : outcome));
  const runners = { runRecipe: run, runCanary: run, runConfirmation: run };
  const openPage = vi.fn(async () => page as unknown as Page);
  let tick = 1000;
  const executor = createExecutor({
    openPage,
    pace: "instant",
    allowHttp: false,
    logger: silentLogger,
    runners: runners as unknown as Runners,
    now: () => (tick += 250),
  });
  return { executor, page, runners, openPage };
}

const live = new AbortController().signal;

const formTask = (overrides = {}) =>
  task(
    "form",
    { requestId: "r1", targetId: "fixture", recipeId: "fixture.remove.v1", recordUrl: null },
    { recipe: recipeFor(ORIGIN, "remove"), fields: { email: "jordan@example.com" }, ...overrides },
  );

const scanTask = () =>
  task(
    "scan",
    { profileId: "p1", targetId: "fixture", recipeId: "fixture.scan.v1", variant: null },
    { recipe: recipeFor(ORIGIN, "scan"), fields: { first_name: "Jordan" } },
  );

describe("which browser a task runs in", () => {
  const done = { status: "completed", result: { outcome: "submitted" } } as const;

  it("opens the page in the browser of the person the task is for", async () => {
    const { executor, openPage } = harness(done);
    await executor(formTask({ profileId: "p-jordan" }), live);
    expect(openPage).toHaveBeenCalledWith("p-jordan");
  });

  it("uses the shared browser for a task that belongs to nobody", async () => {
    const { executor, openPage } = harness(done);
    await executor(formTask(), live);
    expect(openPage).toHaveBeenCalledWith(null);
  });
});

describe("telling the loop that a removal may have submitted", () => {
  it("lets the recipe runner call the loop before it clicks, and only for a form", async () => {
    const mayHaveSubmitted = vi.fn(async () => undefined);
    const { executor, runners } = harness({
      status: "completed",
      result: { outcome: "submitted" },
    });
    await executor(formTask(), live, { mayHaveSubmitted });
    const input = runners.runRecipe.mock.calls[0]?.[0] as { onSubmit?: () => Promise<void> };
    await input.onSubmit?.();
    expect(mayHaveSubmitted).toHaveBeenCalledTimes(1);

    await executor(scanTask(), live, { mayHaveSubmitted });
    expect(runners.runRecipe.mock.calls[1]?.[0]).not.toHaveProperty("onSubmit");
  });
});

describe("running a form task", () => {
  it("runs the recipe with the claimed fields and the target's domain, and completes", async () => {
    const { executor, runners, page } = harness({
      status: "completed",
      result: { outcome: "submitted" },
    });
    const report = await executor(formTask(), live);
    expect(report).toEqual({
      kind: "complete",
      result: { outcome: "submitted" },
      usage: { durationMs: 250 },
    });
    expect(runners.runRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: { email: "jordan@example.com" },
        targetDomain: "127.0.0.1",
        allowHttp: false,
        signal: live,
      }),
    );
    expect(page.close).toHaveBeenCalled();
  });

  it("falls back to the record URL in the payload when the claim left it out of the fields", async () => {
    const { executor, runners } = harness({
      status: "completed",
      result: { outcome: "submitted" },
    });
    const recipe = recipeFor(ORIGIN, "remove", {
      fields: ["email", "record_url"],
      steps: [
        { kind: "goto", url: "{{record_url}}" },
        { kind: "click", target: { css: "button" } },
        { kind: "expect_text", text: "Request received" },
      ],
    });
    await executor(
      task(
        "form",
        {
          requestId: "r1",
          targetId: "fixture",
          recipeId: "fixture.remove.v1",
          recordUrl: "https://broker.test/people/jordan-1",
        },
        { recipe, fields: { email: "jordan@example.com" } },
      ),
      live,
    );
    expect(runners.runRecipe.mock.calls[0]?.[0]).toMatchObject({
      fields: { email: "jordan@example.com", record_url: "https://broker.test/people/jordan-1" },
    });
  });

  it("never overrides a record URL the claim supplied", async () => {
    const { executor, runners } = harness({
      status: "completed",
      result: { outcome: "submitted" },
    });
    const recipe = recipeFor(ORIGIN, "remove", {
      fields: ["record_url"],
      steps: [
        { kind: "goto", url: "{{record_url}}" },
        { kind: "expect_text", text: "Request received" },
      ],
    });
    await executor(
      task(
        "form",
        {
          requestId: "r1",
          targetId: "fixture",
          recipeId: "fixture.remove.v1",
          recordUrl: "https://broker.test/payload",
        },
        { recipe, fields: { record_url: "https://broker.test/claimed" } },
      ),
      live,
    );
    expect(runners.runRecipe.mock.calls[0]?.[0].fields.record_url).toBe(
      "https://broker.test/claimed",
    );
  });

  it("reports a run that ended for a human check as a block, with its screenshot and page", async () => {
    const { executor } = harness({
      status: "blocked",
      reason: "captcha",
      detail: "reCAPTCHA is on the page and needs a person.",
      screenshot: PNG,
    });
    const report = await executor(formTask(), live);
    expect(report).toEqual({
      kind: "block",
      report: {
        reason: "captcha",
        detail: "reCAPTCHA is on the page and needs a person.",
        url: "https://broker.test/blocked",
        screenshot: { mime: "image/png", dataBase64: PNG.toString("base64") },
        usage: { durationMs: 250 },
      },
    });
  });

  it("leaves out a screenshot that is missing or too large, and a page that is not on the web", async () => {
    const missing = harness(
      { status: "blocked", reason: "bot_detection", detail: "bot check", screenshot: null },
      "about:blank",
    );
    expect(await missing.executor(formTask(), live)).toEqual({
      kind: "block",
      report: { reason: "bot_detection", detail: "bot check", usage: { durationMs: 250 } },
    });
    const huge = harness({
      status: "blocked",
      reason: "captcha",
      detail: "x",
      screenshot: Buffer.alloc(MAX_SCREENSHOT_BYTES + 1),
    });
    const report = await huge.executor(formTask(), live);
    expect(report.kind === "block" && report.report.screenshot).toBeUndefined();
  });

  it("passes a failure's kind, step, and retryability through", async () => {
    const { executor } = harness({
      status: "failed",
      kind: "recipe",
      error: "click could not find role=button",
      retryable: false,
      step: 3,
    });
    expect(await executor(formTask(), live)).toEqual({
      kind: "fail",
      report: {
        error: "click could not find role=button",
        retryable: false,
        kind: "recipe",
        step: 3,
        usage: { durationMs: 250 },
      },
    });
  });

  it("omits the step of a failure that has none and never sends an empty message", async () => {
    const { executor } = harness({ status: "failed", kind: "site", error: "", retryable: true });
    const report = await executor(formTask(), live);
    expect(report).toMatchObject({
      kind: "fail",
      report: { error: "The run failed", retryable: true, kind: "site" },
    });
    expect(report.kind === "fail" && "step" in report.report).toBe(false);
  });

  it("hands the task back instead of failing it when the worker is shutting down", async () => {
    const controller = new AbortController();
    const { executor } = harness(() => {
      controller.abort();
      return { status: "failed", kind: "internal", error: "aborted", retryable: true } as never;
    });
    expect(await executor(formTask(), controller.signal)).toMatchObject({ kind: "release" });
  });

  it("rejects a result that does not match the task's schema instead of sending it", async () => {
    const { executor } = harness({ status: "completed", result: { outcome: "exploded" } });
    expect(await executor(formTask(), live)).toMatchObject({
      kind: "fail",
      report: { kind: "internal", retryable: false },
    });
  });

  it("turns anything the runner throws into a retryable internal failure and closes the page", async () => {
    const { executor, page } = harness(() => {
      throw new Error("kaboom\nwith a stack");
    });
    expect(await executor(formTask(), live)).toEqual({
      kind: "fail",
      report: { error: "kaboom", retryable: true, kind: "internal" },
    });
    expect(page.close).toHaveBeenCalled();
  });
});

describe("tasks it cannot run", () => {
  it("fails a form task with no recipe, for good", async () => {
    const { executor, openPage } = harness({ status: "completed", result: {} });
    const report = await executor(formTask({ recipe: null }), live);
    expect(report).toMatchObject({ kind: "fail", report: { kind: "internal", retryable: false } });
    expect(openPage).not.toHaveBeenCalled();
  });

  it("fails a task whose recipe has the wrong purpose", async () => {
    const { executor } = harness({ status: "completed", result: {} });
    const wrongForm = await executor(formTask({ recipe: recipeFor(ORIGIN, "scan") }), live);
    expect(wrongForm).toMatchObject({ kind: "fail", report: { retryable: false } });
    const wrongScan = await executor(
      task(
        "scan",
        { profileId: "p1", targetId: "fixture", recipeId: null, variant: null },
        { recipe: recipeFor(ORIGIN, "remove") },
      ),
      live,
    );
    expect(wrongScan).toMatchObject({ kind: "fail", report: { retryable: false } });
  });

  it("hands an agent task back for a client that has a model", async () => {
    const { executor, openPage } = harness({ status: "completed", result: {} });
    const report = await executor(
      task("agent", {
        purpose: "remove",
        profileId: "p1",
        targetId: "fixture",
        requestId: "r1",
        recordUrl: null,
        variant: null,
        rights: ["opt_out"],
        reason: "no_recipe",
        previousError: null,
        blockedReason: null,
      }),
      live,
    );
    expect(report).toMatchObject({ kind: "release", retryAfterMs: 300_000 });
    expect(openPage).not.toHaveBeenCalled();
  });

  it("hands the task back, without blaming it, when no browser page can be opened", async () => {
    const { executor, openPage } = harness({ status: "completed", result: {} });
    openPage.mockRejectedValueOnce(new Error("no display"));
    expect(await executor(formTask(), live)).toMatchObject({
      kind: "release",
      retryAfterMs: 60_000,
    });
  });
});

describe("the other task kinds", () => {
  it("runs a scan recipe and completes with its candidates", async () => {
    const candidates = {
      candidates: [
        {
          recordUrl: "https://broker.test/people/jordan-1",
          name: "Jordan Example",
          locations: ["Austin, TX"],
        },
      ],
    };
    const { executor, runners } = harness({ status: "completed", result: candidates });
    const report = await executor(scanTask(), live);
    expect(report).toMatchObject({ kind: "complete", result: candidates });
    expect(runners.runRecipe.mock.calls[0]?.[0]).toMatchObject({
      fields: { first_name: "Jordan" },
    });
  });

  it("checks a canary without any fields", async () => {
    const { executor, runners } = harness({
      status: "completed",
      result: { healthy: false, missingSelectors: ['label="Email"'] },
    });
    const report = await executor(
      task("canary", { recipeId: "fixture.remove.v1" }, { recipe: recipeFor(ORIGIN, "remove") }),
      live,
    );
    expect(report).toMatchObject({
      kind: "complete",
      result: { healthy: false, missingSelectors: ['label="Email"'] },
    });
    expect(runners.runCanary.mock.calls[0]?.[0]).not.toHaveProperty("fields");
  });

  it("opens an emailed link on the broker's domain and reports whether it confirmed", async () => {
    const { executor, runners } = harness({
      status: "completed",
      result: { confirmed: true, finalUrl: "https://broker.test/confirmed" },
    });
    const report = await executor(
      task("confirm", { requestId: "r1", url: "https://broker.test/confirm?token=abc" }),
      live,
    );
    expect(report).toMatchObject({ kind: "complete", result: { confirmed: true } });
    expect(runners.runConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://broker.test/confirm?token=abc",
        targetDomain: "127.0.0.1",
      }),
    );
  });

  it("fails a canary task that has no recipe", async () => {
    const { executor } = harness({ status: "completed", result: {} });
    const report = await executor(task("canary", { recipeId: "x" }), live);
    expect(report).toMatchObject({ kind: "fail", report: { retryable: false } });
  });
});
