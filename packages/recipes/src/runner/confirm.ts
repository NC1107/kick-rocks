import { type ConfirmResult, isOnDomain } from "@kickrocks/shared";
import type { Page } from "playwright";
import type { RunOutcome } from "../types.js";
import { createContext, guard, type RunContext } from "./context.js";
import { RunAborted, RunFailure, toFailure } from "./errors.js";
import type { RunnerOptions } from "./options.js";
import { pageText } from "./text.js";

interface RunConfirmationInput extends RunnerOptions {
  page: Page;
  /** The link from the broker's email. */
  url: string;
  /** The broker's domain; the link must be on it. */
  targetDomain: string;
}

/** Wording of a confirmation page that did not take the confirmation. */
const REFUSED = [
  /\b(link|token|code|request) (has )?(expired|is (no longer )?valid|is invalid)/i,
  /\b(expired|invalid) (link|token|code)\b/i,
  /\bno longer valid\b/i,
  /\balready (been )?used\b/i,
  /\bsomething went wrong\b/i,
];

const CONFIRM_BUTTON =
  /\b(confirm|verify|continue|complete|submit|proceed|remove|opt[ -]?out|unsubscribe|delete|yes)\b/i;
const DECLINE_BUTTON = /\b(cancel|no|keep|back|decline|stay)\b/i;
const BUTTON_SELECTOR = "button, input[type=submit], input[type=button], [role=button]";

type PressResult = "none" | "pressed" | "ambiguous";

/**
 * A confirmation page often waits for a button, and loading it confirms nothing. The button is
 * pressed only when exactly one visible button reads like a confirmation, because guessing between
 * "Remove" and "Keep my listing" could undo what the person asked for.
 */
async function pressConfirmButton(ctx: RunContext): Promise<PressResult> {
  const buttons = ctx.page.locator(BUTTON_SELECTOR);
  const wanted = [];
  for (const button of await buttons.all()) {
    if (!(await button.isVisible())) continue;
    const label = (
      (await button.innerText()) || (await button.inputValue().catch(() => ""))
    ).trim();
    if (CONFIRM_BUTTON.test(label) && !DECLINE_BUTTON.test(label)) wanted.push(button);
  }
  if (wanted.length === 0) return "none";
  const [only] = wanted;
  if (wanted.length > 1 || only === undefined) return "ambiguous";
  await only.click({ timeout: ctx.timeouts.stepMs });
  await ctx.page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => undefined);
  await ctx.page.waitForLoadState("load", { timeout: 5000 }).catch(() => undefined);
  return "pressed";
}

function withoutQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

const REFUSED_NOTE = "The page says the link is expired, invalid, or already used.";

function notConfirmed(finalUrl: string, notes: string): RunOutcome<ConfirmResult> {
  return { status: "completed", result: { confirmed: false, finalUrl, notes } };
}

/**
 * Opens an email confirmation link that the plain link follower could not complete, such as one
 * that needs JavaScript or a button press. The link has to be on the broker's own domain and https,
 * because a link in an email is the one place a stranger gets to choose where the browser goes.
 * The final address is reported without its query, which holds the one-time token.
 */
export async function runConfirmation(
  input: RunConfirmationInput,
): Promise<RunOutcome<ConfirmResult>> {
  const ctx: RunContext = createContext(input.page, {}, input.targetDomain, input);
  const { page, url } = input;
  const schemeOk = /^https:/i.test(url) || (ctx.allowHttp && /^http:/i.test(url));
  if (!schemeOk || !isOnDomain(url, ctx.targetDomain)) {
    return {
      status: "failed",
      kind: "internal",
      error: `The confirmation link is not an https link on ${ctx.targetDomain}`,
      retryable: false,
    };
  }
  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: ctx.timeouts.navigationMs,
    });
    await page.waitForLoadState("load", { timeout: 5000 }).catch(() => undefined);
    const stopped = await guard(ctx);
    if (stopped) return stopped;
    const status = response?.status() ?? 0;
    if (status >= 500 || status === 429) {
      throw new RunFailure("site", `The site answered ${status}`, true);
    }
    let finalUrl = withoutQuery(page.url());
    if (status >= 400) {
      return {
        status: "completed",
        result: { confirmed: false, finalUrl, notes: `The site answered ${status}.` },
      };
    }
    const refused = async () => {
      const text = await pageText(page);
      return REFUSED.some((pattern) => pattern.test(text));
    };
    if (await refused()) return notConfirmed(finalUrl, REFUSED_NOTE);
    const pressed = await pressConfirmButton(ctx);
    if (pressed === "ambiguous") {
      return notConfirmed(finalUrl, "The page has more than one button, so none was pressed.");
    }
    if (pressed === "pressed") {
      const afterPress = await guard(ctx);
      if (afterPress) return afterPress;
      finalUrl = withoutQuery(page.url());
      if (await refused()) return notConfirmed(finalUrl, REFUSED_NOTE);
    }
    return { status: "completed", result: { confirmed: true, finalUrl } };
  } catch (error) {
    if (error instanceof RunAborted || ctx.signal?.aborted) {
      return { status: "failed", kind: "internal", error: "The run was aborted", retryable: true };
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return {
        status: "failed",
        kind: "site",
        error: "The page did not load in time",
        retryable: true,
      };
    }
    const failure = toFailure(error);
    return {
      status: "failed",
      kind: failure.kind,
      error: failure.message.replace(/https?:\/\/\S+/g, withoutQuery),
      retryable: failure.retryable,
    };
  }
}
