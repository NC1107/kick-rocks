import {
  type FormResult,
  normalizeRecordUrl,
  type RecipeStep,
  type Selector,
} from "@kickrocks/shared";
import type { Locator } from "playwright";
import type { RunOutcome } from "../types.js";
import {
  blocked,
  blockedBy,
  checkLive,
  describeBlock,
  guard,
  type RunContext,
  recordUrlProblem,
  render,
} from "./context.js";
import { waitForBlock } from "./detect.js";
import { RunFailure, recipeFailure } from "./errors.js";
import { extractCandidates, findRecordIndex } from "./extract.js";
import {
  describeSelector,
  existsNow,
  findAll,
  findFrame,
  findLocator,
  pollUntil,
  type Scope,
  waitForState,
} from "./locate.js";
import { between, keyDelay, typesByKey } from "./pacing.js";
import { IS_CHECKABLE, READ_OPTIONS } from "./page-scripts.js";
import { clip, normalizeText, pageText, textContains, webUrlFrom } from "./text.js";

/** A step that ends the run: for a person, or with a form outcome. Null means carry on. */
export type Ended = Extract<RunOutcome<FormResult>, { status: "blocked" | "completed" }> | null;

const RECORD_URL_TEMPLATE = /^\{\{\s*record_url\s*\}\}$/;
const SENDER_DOMAIN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const CONFIRMATION_TEXT_LIMIT = 500;

type Targeted = { target: Selector; frame?: Selector | undefined; optional?: boolean | undefined };

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split("\n")[0] ?? message).slice(0, 300);
}

/** A Playwright action that timed out means the page no longer behaves as the recipe says. */
async function act(
  kind: string,
  selector: Selector,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw recipeFailure(
        `${kind} did not work on ${describeSelector(selector)}: ${firstLine(error)}`,
      );
    }
    throw error;
  }
}

async function scopeOf(
  ctx: RunContext,
  frame: Selector | undefined,
  timeoutMs: number,
): Promise<Scope | null> {
  if (frame === undefined) return ctx.page;
  return findFrame(ctx.page, frame, { timeoutMs, signal: ctx.signal });
}

/**
 * Finds a step's element. Null means an optional step should be skipped because its element, or
 * the frame it lives in, did not show up in the short optional timeout.
 */
async function locate(
  ctx: RunContext,
  kind: string,
  step: Targeted,
  state: "visible" | "attached" = "visible",
): Promise<Locator | null> {
  const optional = step.optional === true;
  const timeoutMs = optional ? ctx.timeouts.optionalMs : ctx.timeouts.stepMs;
  const scope = await scopeOf(ctx, step.frame, timeoutMs);
  if (scope === null) {
    if (optional) return null;
    throw recipeFailure(
      `${kind} could not find the frame ${describeSelector(step.frame as Selector)}`,
    );
  }
  const found = await findLocator(scope, step.target, { timeoutMs, signal: ctx.signal, state });
  if (found === null && !optional) {
    throw recipeFailure(`${kind} could not find ${describeSelector(step.target)}`);
  }
  return found;
}

async function settle(ctx: RunContext): Promise<void> {
  await ctx.page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => undefined);
}

/** After anything that can load a new page: let it settle, then stop for a human check if one shows. */
async function afterNavigation(ctx: RunContext): Promise<Ended> {
  await settle(ctx);
  return guard(ctx);
}

async function pauseBeforeAction(ctx: RunContext): Promise<void> {
  await ctx.pace.sleep(between(ctx.pace.actionPauseMs, ctx.pace.random), ctx.signal);
}

function fieldValue(
  ctx: RunContext,
  step: { field?: string | undefined; value?: string | undefined },
) {
  if (step.field !== undefined) {
    const value = ctx.fields[step.field as keyof typeof ctx.fields];
    if (value === undefined) {
      throw new RunFailure("internal", `The profile has no value for ${step.field}`, false);
    }
    return value;
  }
  return render(ctx, step.value ?? "");
}

/** Whether an optional step can be skipped because the value it would use is not available. */
function valueMissing(
  ctx: RunContext,
  step: { field?: string | undefined; value?: string | undefined; optional?: boolean },
) {
  if (step.optional !== true) return false;
  try {
    fieldValue(ctx, step);
    return false;
  } catch (error) {
    if (error instanceof RunFailure && error.kind === "internal") return true;
    throw error;
  }
}

async function typeInto(ctx: RunContext, field: Locator, value: string): Promise<void> {
  const timeout = ctx.timeouts.stepMs;
  if (!typesByKey(ctx.pace)) {
    await field.fill(value, { timeout });
    return;
  }
  await field.click({ timeout });
  await field.fill("", { timeout });
  for (const key of value) {
    await ctx.page.keyboard.type(key);
    await ctx.pace.sleep(keyDelay(ctx.pace), ctx.signal);
  }
}

async function goto(ctx: RunContext, template: string): Promise<Ended> {
  const url = render(ctx, template);
  const isRecord = RECORD_URL_TEMPLATE.test(template);
  if (isRecord) {
    const problem = recordUrlProblem(ctx, url);
    if (problem !== null) throw recipeFailure(problem);
  }
  let status: number | null;
  try {
    const response = await ctx.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: ctx.timeouts.navigationMs,
    });
    status = response?.status() ?? null;
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new RunFailure("site", "The page did not load in time", true);
    }
    throw error;
  }
  ctx.state.lastStatus = status;
  await ctx.page.waitForLoadState("load", { timeout: 5000 }).catch(() => undefined);
  if (isRecord && recordUrlProblem(ctx, ctx.page.url()) !== null) {
    throw recipeFailure("The record page sent the browser to another site");
  }
  const stopped = await guard(ctx);
  if (stopped) return stopped;
  if (status !== null && (status >= 500 || status === 429)) {
    throw new RunFailure("site", `The site answered ${status}`, true);
  }
  // Bot management often answers 401 or 403 with a body the detector has no words for, and the
  // form the next step looks for is then missing for a reason that says nothing about the recipe.
  if (status === 401 || status === 403) {
    return blocked(ctx, "bot_detection", `The site answered ${status} to the browser.`);
  }
  return null;
}

/** Opens a page as the first thing a run does, or as a canary's first step. */
export const openPage = goto;

async function fill(ctx: RunContext, step: Extract<RecipeStep, { kind: "fill" }>): Promise<Ended> {
  if (valueMissing(ctx, step)) return null;
  const field = await locate(ctx, "fill", step);
  if (field === null) return null;
  const value = fieldValue(ctx, step);
  await pauseBeforeAction(ctx);
  await act("fill", step.target, () => typeInto(ctx, field, value));
  return null;
}

function normalizeOption(text: string): string {
  return normalizeText(text);
}

async function choose(
  ctx: RunContext,
  step: Extract<RecipeStep, { kind: "select" }>,
): Promise<Ended> {
  if (valueMissing(ctx, step)) return null;
  const select = await locate(ctx, "select", step);
  if (select === null) return null;
  const wanted = fieldValue(ctx, step);
  const options = await select.evaluate(READ_OPTIONS);
  if (options === null) {
    throw recipeFailure(`select expected ${describeSelector(step.target)} to be a dropdown`);
  }
  const match = options.find((option) =>
    step.by === "value"
      ? option.value === wanted
      : normalizeOption(option.label) === normalizeOption(wanted),
  );
  if (match === undefined || match.disabled) {
    throw recipeFailure(
      `select found no option for ${step.by} in ${describeSelector(step.target)}`,
    );
  }
  await pauseBeforeAction(ctx);
  await act("select", step.target, () =>
    select.selectOption({ value: match.value }, { timeout: ctx.timeouts.stepMs }),
  );
  return null;
}

async function click(
  ctx: RunContext,
  step: Extract<RecipeStep, { kind: "click" }>,
): Promise<Ended> {
  const element = await locate(ctx, "click", step);
  if (element === null) return null;
  await pauseBeforeAction(ctx);
  await act("click", step.target, () => element.click({ timeout: ctx.timeouts.stepMs }));
  ctx.state.proved = false;
  return afterNavigation(ctx);
}

async function check(
  ctx: RunContext,
  step: Extract<RecipeStep, { kind: "check" }>,
): Promise<Ended> {
  const box = await locate(ctx, "check", step);
  if (box === null) return null;
  await pauseBeforeAction(ctx);
  await act("check", step.target, () =>
    box.setChecked(step.checked, { timeout: ctx.timeouts.stepMs }),
  );
  return null;
}

async function press(
  ctx: RunContext,
  step: Extract<RecipeStep, { kind: "press" }>,
): Promise<Ended> {
  if (step.target === undefined) {
    await pauseBeforeAction(ctx);
    await ctx.page.keyboard.press(step.key);
  } else {
    const element = await locate(ctx, "press", { ...step, target: step.target });
    if (element === null) return null;
    await pauseBeforeAction(ctx);
    await act("press", step.target, () =>
      element.press(step.key, { timeout: ctx.timeouts.stepMs }),
    );
  }
  ctx.state.proved = false;
  return afterNavigation(ctx);
}

async function pause(
  ctx: RunContext,
  step: Extract<RecipeStep, { kind: "pause" }>,
): Promise<Ended> {
  const ms = between([step.minMs, step.maxMs], ctx.pace.random) * ctx.pace.pauseScale;
  await ctx.pace.sleep(ms, ctx.signal);
  return null;
}

async function waitFor(
  ctx: RunContext,
  step: Extract<RecipeStep, { kind: "wait_for" }>,
): Promise<Ended> {
  const optional = step.optional === true;
  const requested = step.timeoutMs ?? ctx.timeouts.stepMs;
  const timeoutMs = optional ? Math.min(requested, ctx.timeouts.optionalMs) : requested;
  const scope = await scopeOf(ctx, step.frame, timeoutMs);
  const reached = await waitForState(scope, step.target, step.state, {
    timeoutMs,
    signal: ctx.signal,
  });
  if (!reached && !optional) {
    throw recipeFailure(`wait_for: ${describeSelector(step.target)} did not become ${step.state}`);
  }
  return afterNavigation(ctx);
}

async function expectText(
  ctx: RunContext,
  step: Extract<RecipeStep, { kind: "expect_text" }>,
): Promise<Ended> {
  const found = await pollUntil(async () => textContains(await pageText(ctx.page), step.text), {
    timeoutMs: ctx.timeouts.stepMs,
    signal: ctx.signal,
  });
  if (!found) throw recipeFailure(`expect_text: the page does not show "${step.text}"`);
  ctx.state.proved = true;
  return null;
}

async function expectUrl(
  ctx: RunContext,
  step: Extract<RecipeStep, { kind: "expect_url" }>,
): Promise<Ended> {
  const pattern = new RegExp(step.pattern);
  const found = await pollUntil(async () => pattern.test(ctx.page.url()), {
    timeoutMs: ctx.timeouts.stepMs,
    signal: ctx.signal,
  });
  if (!found) throw recipeFailure(`expect_url: the page address does not match ${step.pattern}`);
  ctx.state.proved = true;
  return null;
}

async function extractCandidatesStep(
  ctx: RunContext,
  step: Extract<RecipeStep, { kind: "extract_candidates" }>,
): Promise<Ended> {
  const scope = await scopeOf(ctx, step.frame, ctx.timeouts.stepMs);
  if (scope === null) throw recipeFailure("extract_candidates could not find its frame");
  const items = await findAll(scope, step.item, {
    timeoutMs: ctx.timeouts.resultsMs,
    signal: ctx.signal,
  });
  if (items === null) {
    const stopped = await guard(ctx);
    if (stopped) return stopped;
    ctx.state.candidates = [];
    return null;
  }
  ctx.state.candidates = await extractCandidates(items, step.fields, ctx.page.url());
  return null;
}

async function extractText(
  ctx: RunContext,
  step: Extract<RecipeStep, { kind: "extract_text" }>,
): Promise<Ended> {
  const element = await locate(ctx, "extract_text", step, "attached");
  if (element === null) return null;
  const text = clip(
    (await element.textContent({ timeout: ctx.timeouts.stepMs })) ?? "",
    CONFIRMATION_TEXT_LIMIT,
  );
  if (step.as === "confirmation_text") {
    ctx.state.confirmationText = text;
    return null;
  }
  const href = await element.getAttribute("href", { timeout: ctx.timeouts.stepMs });
  const url = webUrlFrom(href ?? text, ctx.page.url());
  if (url === null)
    throw recipeFailure("extract_text found no web address to read as the record URL");
  ctx.state.extractedRecordUrl = url;
  return null;
}

async function selectRecord(
  ctx: RunContext,
  step: Extract<RecipeStep, { kind: "select_record" }>,
): Promise<Ended> {
  const recordUrl = ctx.fields.record_url;
  const wanted = recordUrl === undefined ? null : normalizeRecordUrl(recordUrl);
  if (wanted === null) {
    throw new RunFailure(
      "internal",
      "The record URL for this removal is missing or not a web address",
      false,
    );
  }
  const scope = await scopeOf(ctx, step.frame, ctx.timeouts.stepMs);
  if (scope === null) throw recipeFailure("select_record could not find its frame");
  const items = await findAll(scope, step.item, {
    timeoutMs: ctx.timeouts.resultsMs,
    signal: ctx.signal,
  });
  // No results at all is a page that no longer looks the way the recipe expects, not proof that
  // the record is gone: ending as not_found would close the request for good on a stale selector.
  // A recipe that knows how its site words "no results" says so with outcome_when before this step.
  if (items === null) {
    const stopped = await guard(ctx);
    if (stopped) return stopped;
    throw recipeFailure(`select_record found no results matching ${describeSelector(step.item)}`);
  }
  const index = await findRecordIndex(items, step.link, wanted, ctx.page.url());
  if (index < 0) {
    if (!step.exhaustive) {
      return blocked(
        ctx,
        "unknown",
        "The search listed results but none matched the record. A person should check whether it is still listed.",
      );
    }
    return {
      status: "completed",
      result: { outcome: "not_found", notes: "No search result matched the record." },
    };
  }
  const row = items.nth(index);
  await pauseBeforeAction(ctx);
  if (step.action === "click") {
    await act("select_record", step.item, () => row.click({ timeout: ctx.timeouts.stepMs }));
    ctx.state.proved = false;
    return afterNavigation(ctx);
  }
  const box = (await row.evaluate(IS_CHECKABLE))
    ? row
    : row.locator("input[type=checkbox], input[type=radio]").first();
  if ((await box.count()) === 0) {
    throw recipeFailure("select_record found the record but no checkbox to tick");
  }
  await act("select_record", step.item, () => box.check({ timeout: ctx.timeouts.stepMs }));
  return null;
}

async function outcomeWhen(
  ctx: RunContext,
  step: Extract<RecipeStep, { kind: "outcome_when" }>,
): Promise<Ended> {
  const needsText = step.when.some((condition) => condition.text !== undefined);
  const matched = await pollUntil(
    async () => {
      const text = needsText ? await pageText(ctx.page) : "";
      for (const condition of step.when) {
        if (condition.text !== undefined && !textContains(text, condition.text)) continue;
        if (
          condition.urlPattern !== undefined &&
          !new RegExp(condition.urlPattern).test(ctx.page.url())
        )
          continue;
        if (
          condition.selector !== undefined &&
          !(await existsNow(ctx.page, condition.selector, true))
        )
          continue;
        return { condition };
      }
      if (step.continueWhen && (await existsNow(ctx.page, step.continueWhen, true))) {
        return { condition: null };
      }
      return null;
    },
    {
      timeoutMs: step.continueWhen ? ctx.timeouts.stepMs : ctx.timeouts.outcomeSettleMs,
      signal: ctx.signal,
    },
  );
  if (matched === null || matched.condition === null) return null;
  const { condition } = matched;
  if (condition.outcome === "blocked") {
    const reason = condition.reason ?? "unknown";
    return blocked(ctx, reason, describeBlock(reason));
  }
  return { status: "completed", result: formResult(ctx, condition.outcome) };
}

async function captchaCheckpoint(ctx: RunContext): Promise<Ended> {
  const finding = await waitForBlock(ctx.page, {
    waitMs: ctx.timeouts.checkpointMs,
    graceMs: ctx.timeouts.challengeGraceMs,
    signal: ctx.signal,
  });
  return finding === null ? null : blockedBy(ctx, finding);
}

function emailConfirmation(
  ctx: RunContext,
  step: Extract<RecipeStep, { kind: "email_confirmation" }>,
): Ended {
  const domain = step.fromDomain.trim().toLowerCase();
  ctx.state.awaitingEmailFrom = SENDER_DOMAIN.test(domain) ? domain : "";
  return null;
}

export function formResult(ctx: RunContext, outcome: FormResult["outcome"]): FormResult {
  const result: FormResult = { outcome };
  if (ctx.state.confirmationText) result.confirmationText = ctx.state.confirmationText;
  if (outcome === "awaiting_email_confirmation" && ctx.state.awaitingEmailFrom) {
    result.confirmationFrom = ctx.state.awaitingEmailFrom;
  }
  if (ctx.state.extractedRecordUrl) result.notes = `Record page: ${ctx.state.extractedRecordUrl}`;
  return result;
}

/** A fill counts too: moving focus off an edited field fires its change event, and a page may submit on that. */
function sendsToSite(step: RecipeStep): boolean {
  return (
    step.kind === "fill" ||
    step.kind === "click" ||
    step.kind === "press" ||
    step.kind === "select" ||
    step.kind === "check" ||
    step.kind === "select_record"
  );
}

/** Runs one step. A step ends the run by returning an outcome, and otherwise returns null. */
export async function runStep(ctx: RunContext, step: RecipeStep, index: number): Promise<Ended> {
  checkLive(ctx);
  if (sendsToSite(step)) {
    await ctx.onSubmit?.();
    checkLive(ctx);
  }
  try {
    switch (step.kind) {
      case "goto":
        return await goto(ctx, step.url);
      case "fill":
        return await fill(ctx, step);
      case "select":
        return await choose(ctx, step);
      case "click":
        return await click(ctx, step);
      case "check":
        return await check(ctx, step);
      case "press":
        return await press(ctx, step);
      case "pause":
        return await pause(ctx, step);
      case "wait_for":
        return await waitFor(ctx, step);
      case "expect_text":
        return await expectText(ctx, step);
      case "expect_url":
        return await expectUrl(ctx, step);
      case "extract_candidates":
        return await extractCandidatesStep(ctx, step);
      case "extract_text":
        return await extractText(ctx, step);
      case "select_record":
        return await selectRecord(ctx, step);
      case "outcome_when":
        return await outcomeWhen(ctx, step);
      case "captcha_checkpoint":
        return await captchaCheckpoint(ctx);
      case "email_confirmation":
        return emailConfirmation(ctx, step);
    }
  } catch (error) {
    if (error instanceof RunFailure && error.step === undefined) error.step = index;
    throw error;
  }
}
