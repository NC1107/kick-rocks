import {
  type BlockedReason,
  type Candidate,
  isOnDomain,
  type ProfileFields,
  type Pushback,
  parseRetryAfter,
  pushbackKindForStatus,
  renderTemplate,
  type SiteObservation,
  TemplateError,
} from "@kickrocks/shared";
import type { Page, Response } from "playwright";
import type { RunOutcome } from "../types.js";
import { type BlockFinding, detectBlockAfterGrace } from "./detect.js";
import { isClosedError, RunAborted, RunFailure } from "./errors.js";
import { DEFAULT_TIMEOUTS, type RunnerOptions, type Timeouts } from "./options.js";
import { HUMAN_PACE, type Pace, sleepFor } from "./pacing.js";
import { createRedactor } from "./redact.js";

/** What a run has learned so far, which later steps and the final result draw on. */
export interface RunState {
  candidates: Candidate[];
  confirmationText: string | undefined;
  extractedRecordUrl: string | undefined;
  awaitingEmailFrom: string | undefined;
  lastStatus: number | null;
  /** What the site did that says to slow down, the first time it did it in this run. */
  pushback: Pushback | undefined;
  /** The status of the newest page the main frame loaded, cleared once a step has judged it. */
  navigationStatus: number | null;
  /** The page showed that the site took the last submission; any later submit clears it. */
  proved: boolean;
}

export interface RunContext {
  page: Page;
  fields: ProfileFields;
  pace: Pace;
  timeouts: Timeouts;
  signal: AbortSignal | undefined;
  targetDomain: string;
  allowHttp: boolean;
  redact: (text: string) => string;
  onSubmit: (() => void | Promise<void>) | undefined;
  deadline: number;
  /** Stops watching the page; every run calls it when it ends. */
  stop: () => void;
  state: RunState;
}

/** Fields the run may use: a blank value counts as missing, so it is never typed into a form. */
export function usableFields(fields: ProfileFields): ProfileFields {
  const usable: ProfileFields = {};
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === "string" && value.trim() !== "") {
      usable[name as keyof ProfileFields] = value;
    }
  }
  return usable;
}

export function createContext(
  page: Page,
  fields: ProfileFields,
  fallbackDomain: string,
  options: RunnerOptions,
): RunContext {
  const timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  const usable = usableFields(fields);
  const state: RunState = {
    candidates: [],
    confirmationText: undefined,
    extractedRecordUrl: undefined,
    awaitingEmailFrom: undefined,
    lastStatus: null,
    pushback: undefined,
    navigationStatus: null,
    proved: false,
  };
  const stop = watchNavigations(page, state);
  return {
    page,
    fields: usable,
    pace: options.pace ?? HUMAN_PACE,
    timeouts,
    signal: options.signal,
    targetDomain: options.targetDomain ?? fallbackDomain,
    allowHttp: options.allowHttp ?? false,
    redact: createRedactor(usable),
    onSubmit: options.onSubmit,
    deadline: Date.now() + timeouts.runMs,
    stop,
    state,
  };
}

/**
 * Reads every page the main frame loads, whatever started the load. A search that is rate limited
 * usually answers the submit, not the first visit, so looking only at `goto` would miss it.
 */
function watchNavigations(page: Page, state: RunState): () => void {
  const onResponse = (response: Response): void => {
    if (!response.request().isNavigationRequest()) return;
    if (response.frame() !== page.mainFrame()) return;
    state.navigationStatus = response.status();
    notePushback(state, response);
  };
  page.on("response", onResponse);
  return () => page.off("response", onResponse);
}

/** Remembers a 429, 403, 503, or Cloudflare challenge, with the wait the site asked for. */
export function notePushback(state: RunState, response: Response): void {
  if (state.pushback) return;
  const status = response.status();
  const headers = response.headers();
  const kind =
    headers["cf-mitigated"] === "challenge" ? "challenge" : pushbackKindForStatus(status);
  if (kind === null) return;
  const retryAfterSeconds = parseRetryAfter(headers["retry-after"], new Date());
  state.pushback = {
    kind,
    status,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

export function hostOf(url: string): string {
  return new URL(url).hostname;
}

/** Renders a template, failing the run on anything that would leave a half-filled value. */
export function render(ctx: RunContext, template: string): string {
  try {
    return renderTemplate(template, ctx.fields);
  } catch (error) {
    if (error instanceof TemplateError) {
      throw new RunFailure("internal", `Cannot fill a value: ${ctx.redact(error.message)}`, false);
    }
    throw error;
  }
}

export function checkLive(ctx: RunContext): void {
  if (ctx.signal?.aborted) throw new RunAborted();
  if (Date.now() > ctx.deadline) {
    throw new RunFailure("site", "The run took longer than its time limit", true);
  }
}

/**
 * A record URL comes from a scan result the person confirmed, but it ultimately came from a web
 * page, so it is checked before the browser goes there: https, no embedded credentials, and the
 * broker's own domain, so a bad record can never send the person's details somewhere else.
 */
export function recordUrlProblem(ctx: RunContext, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "The record URL is not a valid URL";
  }
  const schemeOk = parsed.protocol === "https:" || (ctx.allowHttp && parsed.protocol === "http:");
  if (!schemeOk) return "The record URL is not an https URL";
  if (parsed.username !== "" || parsed.password !== "") {
    return "The record URL carries credentials";
  }
  if (!isOnDomain(url, ctx.targetDomain)) {
    return `The record URL is not on ${ctx.targetDomain}`;
  }
  return null;
}

const BLOCK_SENTENCES: Record<BlockedReason, string> = {
  captcha: "The site shows a CAPTCHA that needs a person.",
  phone_verification: "The site asks for phone verification.",
  id_upload: "The site asks for an ID upload.",
  email_verification: "The site asks for email verification before it will continue.",
  login_required: "The site needs a login.",
  bot_detection: "The site is blocking automated browsers.",
  unknown: "The site stopped the run for a human check.",
};

export function describeBlock(reason: BlockedReason): string {
  return BLOCK_SENTENCES[reason];
}

/**
 * Chrome answers "unable to capture screenshot" when a page has not painted yet, which a page that
 * has just opened can still be, so a few quick retries cost less than a block with no picture.
 */
async function takeScreenshot(ctx: RunContext): Promise<Buffer | null> {
  for (const wait of [0, 200, 500, 1000]) {
    await sleepFor(wait, ctx.signal);
    try {
      return await ctx.page.screenshot({ type: "png", timeout: 5000 });
    } catch (error) {
      if (isClosedError(error)) return null;
    }
  }
  return null;
}

/** Ends the run for a person, with a screenshot of what the page showed. */
export async function blocked(
  ctx: RunContext,
  reason: BlockedReason,
  detail: string,
): Promise<Extract<RunOutcome<never>, { status: "blocked" }>> {
  const screenshot = await takeScreenshot(ctx);
  return { status: "blocked", reason, detail, screenshot };
}

export async function blockedBy(ctx: RunContext, finding: BlockFinding) {
  ctx.state.pushback ??= { kind: finding.pushback };
  return blocked(ctx, finding.reason, finding.detail);
}

/** What the run saw of the site, for the server to pace the next visit. Undefined when nothing stands out. */
export function siteObservation(ctx: RunContext): SiteObservation | undefined {
  const { pushback } = ctx.state;
  return pushback === undefined ? undefined : { pushback };
}

/** Adds what the run saw of the site to however the run ended. */
export function withSite<R>(ctx: RunContext, outcome: RunOutcome<R>): RunOutcome<R> {
  ctx.stop();
  const site = siteObservation(ctx);
  return site === undefined ? outcome : { ...outcome, site };
}

/** Looks for a human check and ends the run for a person when there is one. */
export async function guard(ctx: RunContext) {
  const finding = await detectBlockAfterGrace(ctx.page, {
    graceMs: ctx.timeouts.challengeGraceMs,
    signal: ctx.signal,
  });
  return finding === null ? null : blockedBy(ctx, finding);
}
