import {
  type BlockedReason,
  type Candidate,
  isOnDomain,
  type ProfileFields,
  renderTemplate,
  TemplateError,
} from "@kickrocks/shared";
import type { Page } from "playwright";
import type { RunOutcome } from "../types.js";
import { type BlockFinding, detectBlockAfterGrace } from "./detect.js";
import { RunAborted, RunFailure } from "./errors.js";
import { DEFAULT_TIMEOUTS, type RunnerOptions, type Timeouts } from "./options.js";
import { HUMAN_PACE, type Pace } from "./pacing.js";
import { createRedactor } from "./redact.js";

/** What a run has learned so far, which later steps and the final result draw on. */
export interface RunState {
  candidates: Candidate[];
  confirmationText: string | undefined;
  extractedRecordUrl: string | undefined;
  awaitingEmailFrom: string | undefined;
  lastStatus: number | null;
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
  deadline: number;
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
  return {
    page,
    fields: usable,
    pace: options.pace ?? HUMAN_PACE,
    timeouts,
    signal: options.signal,
    targetDomain: options.targetDomain ?? fallbackDomain,
    allowHttp: options.allowHttp ?? false,
    redact: createRedactor(usable),
    deadline: Date.now() + timeouts.runMs,
    state: {
      candidates: [],
      confirmationText: undefined,
      extractedRecordUrl: undefined,
      awaitingEmailFrom: undefined,
      lastStatus: null,
    },
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

/** Ends the run for a person, with a screenshot of what the page showed. */
export async function blocked(
  ctx: RunContext,
  reason: BlockedReason,
  detail: string,
): Promise<Extract<RunOutcome<never>, { status: "blocked" }>> {
  const screenshot = await ctx.page.screenshot({ type: "png", timeout: 5000 }).catch(() => null);
  return { status: "blocked", reason, detail, screenshot };
}

export async function blockedBy(ctx: RunContext, finding: BlockFinding) {
  return blocked(ctx, finding.reason, finding.detail);
}

/** Looks for a human check and ends the run for a person when there is one. */
export async function guard(ctx: RunContext) {
  const finding = await detectBlockAfterGrace(ctx.page, {
    graceMs: ctx.timeouts.challengeGraceMs,
    signal: ctx.signal,
  });
  return finding === null ? null : blockedBy(ctx, finding);
}
