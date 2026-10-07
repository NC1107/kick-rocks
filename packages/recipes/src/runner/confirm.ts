import { type ConfirmResult, isOnDomain } from "@kickrocks/shared";
import type { Page } from "playwright";
import type { RunOutcome } from "../types.js";
import { createContext, guard, type RunContext } from "./context.js";
import { RunAborted, RunFailure, toFailure } from "./errors.js";
import type { RunnerOptions } from "./options.js";
import { pageText } from "./text.js";

export interface RunConfirmationInput extends RunnerOptions {
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

function withoutQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Opens an email confirmation link that the plain link follower could not complete, such as one
 * that needs JavaScript. The link has to be on the broker's own domain and https, because a link
 * in an email is the one place a stranger gets to choose where the browser goes. The final address
 * is reported without its query, which holds the one-time token.
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
    const finalUrl = withoutQuery(page.url());
    if (status >= 400) {
      return {
        status: "completed",
        result: { confirmed: false, finalUrl, notes: `The site answered ${status}.` },
      };
    }
    const text = await pageText(page);
    if (REFUSED.some((pattern) => pattern.test(text))) {
      return {
        status: "completed",
        result: {
          confirmed: false,
          finalUrl,
          notes: "The page says the link is expired, invalid, or already used.",
        },
      };
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
