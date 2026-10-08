import type { Selector } from "@kickrocks/shared";
import type { Locator, Page } from "playwright";
import { isClosedError, isTransientPageError, RunAborted, recipeFailure } from "./errors.js";
import { sleepFor } from "./pacing.js";

/** The part of a page, frame, or iframe handle that finds elements. */
export interface Scope {
  getByRole: Page["getByRole"];
  getByLabel: Page["getByLabel"];
  getByTestId: Page["getByTestId"];
  getByText: Page["getByText"];
  locator: Page["locator"];
}

type ElementState = "visible" | "hidden" | "attached" | "detached";

const POLL_MS = 100;

type Role = Parameters<Page["getByRole"]>[0];

/**
 * Every way a selector can find its element, in the order the recipe format promises: role and
 * label, then test id, then CSS, then visible text. A selector with several keys is a list of
 * fallbacks, so a page that renames a test id can still be found by its CSS.
 */
function candidatesOf(scope: Scope, selector: Selector): Locator[] {
  const found: Locator[] = [];
  if (selector.role !== undefined) {
    found.push(
      scope.getByRole(
        selector.role as Role,
        selector.label === undefined ? {} : { name: selector.label },
      ),
    );
  } else if (selector.label !== undefined) {
    found.push(scope.getByLabel(selector.label));
  }
  if (selector.testId !== undefined) found.push(scope.getByTestId(selector.testId));
  if (selector.css !== undefined) found.push(scope.locator(selector.css));
  if (selector.text !== undefined) found.push(scope.getByText(selector.text));
  return found;
}

/** A short description for messages. It never includes page content or profile values. */
export function describeSelector(selector: Selector): string {
  const parts: string[] = [];
  if (selector.role !== undefined) {
    parts.push(
      selector.label === undefined
        ? `role=${selector.role}`
        : `role=${selector.role}[name="${selector.label}"]`,
    );
  } else if (selector.label !== undefined) {
    parts.push(`label="${selector.label}"`);
  }
  if (selector.testId !== undefined) parts.push(`testid=${selector.testId}`);
  if (selector.css !== undefined) parts.push(`css=${selector.css}`);
  if (selector.text !== undefined) parts.push(`text="${selector.text}"`);
  return parts.join(" | ");
}

interface PollOptions {
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

/** Runs `attempt` until it answers or the time is up, tolerating a page that is mid-navigation. */
export async function pollUntil<T>(
  attempt: () => Promise<T | null | undefined | false>,
  { timeoutMs, signal }: PollOptions,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new RunAborted();
    try {
      const answer = await attempt();
      if (answer) return answer;
    } catch (error) {
      if (!isTransientPageError(error)) throw error;
    }
    if (Date.now() >= deadline) return null;
    await sleepFor(Math.min(POLL_MS, Math.max(0, deadline - Date.now())), signal);
  }
}

function asSelectorFailure(selector: Selector, error: unknown): never {
  if (isClosedError(error) || error instanceof RunAborted) throw error;
  const message = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
  throw recipeFailure(`Cannot use selector ${describeSelector(selector)}: ${message}`);
}

/**
 * Waits for an element to be there and returns a locator for the first match, trying each of the
 * selector's strategies in order on every poll. An element has to be visible, so a hidden twin
 * earlier in the page does not hide the one the person can see.
 */
export async function findLocator(
  scope: Scope,
  selector: Selector,
  options: PollOptions & { state?: "visible" | "attached" },
): Promise<Locator | null> {
  const needVisible = (options.state ?? "visible") === "visible";
  try {
    return await pollUntil(async () => {
      for (const candidate of candidatesOf(scope, selector)) {
        const narrowed = needVisible ? candidate.filter({ visible: true }) : candidate;
        if ((await narrowed.count()) > 0) return narrowed.first();
      }
      return null;
    }, options);
  } catch (error) {
    return asSelectorFailure(selector, error);
  }
}

/** Every element a selector matches, from the first strategy that matches anything. */
export async function findAll(
  scope: Scope,
  selector: Selector,
  options: PollOptions,
): Promise<Locator | null> {
  try {
    return await pollUntil(async () => {
      for (const candidate of candidatesOf(scope, selector)) {
        if ((await candidate.count()) > 0) return candidate;
      }
      return null;
    }, options);
  } catch (error) {
    return asSelectorFailure(selector, error);
  }
}

async function anyMatch(scope: Scope, selector: Selector, visibleOnly: boolean): Promise<boolean> {
  for (const candidate of candidatesOf(scope, selector)) {
    const narrowed = visibleOnly ? candidate.filter({ visible: true }) : candidate;
    if ((await narrowed.count()) > 0) return true;
  }
  return false;
}

/** Waits for an element to reach a state. `hidden` and `detached` need every strategy to agree. */
export async function waitForState(
  scope: Scope | null,
  selector: Selector,
  state: ElementState,
  options: PollOptions,
): Promise<boolean> {
  const goneIsFine = state === "hidden" || state === "detached";
  if (scope === null) return goneIsFine;
  try {
    const reached = await pollUntil(async () => {
      const present = await anyMatch(scope, selector, state === "visible" || state === "hidden");
      return (goneIsFine ? !present : present) || null;
    }, options);
    return reached === true;
  } catch (error) {
    return asSelectorFailure(selector, error);
  }
}

/** The scopes to search when a step does not name a frame: the page, then every frame in it. */
function allScopes(page: Page): Scope[] {
  return page.frames();
}

/** Whether a selector shows up right now in the page or any of its frames. */
export async function existsNow(
  page: Page,
  selector: Selector,
  visibleOnly: boolean,
): Promise<boolean> {
  for (const scope of allScopes(page)) {
    try {
      if (await anyMatch(scope, selector, visibleOnly)) return true;
    } catch (error) {
      if (isClosedError(error)) throw error;
      if (isTransientPageError(error)) continue;
      asSelectorFailure(selector, error);
    }
  }
  return false;
}

/** Waits for a selector to exist in the page or any of its frames. */
export async function existsWithin(
  page: Page,
  selector: Selector,
  options: PollOptions & { visibleOnly: boolean },
): Promise<boolean> {
  const found = await pollUntil(
    async () => (await existsNow(page, selector, options.visibleOnly)) || null,
    options,
  );
  return found === true;
}

/** The scope of an iframe named by a selector, or null when it never shows up. */
export async function findFrame(
  page: Page,
  frame: Selector,
  options: PollOptions,
): Promise<Scope | null> {
  const element = await findLocator(page, frame, { ...options, state: "attached" });
  return element === null ? null : element.contentFrame();
}
