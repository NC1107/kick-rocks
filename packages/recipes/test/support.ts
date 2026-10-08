import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type ProfileField,
  Recipe,
  type RecipeInput,
  type RecipePurpose,
  recipeId,
} from "@kickrocks/shared";
import { type Browser, chromium } from "playwright";
import { describe } from "vitest";
import { INSTANT_PACE, type RunnerOptions } from "../src/index.js";

/** Playwright's own Chromium, then one from the shared cache, then a Chrome installed on the system. */
export function findBrowserExecutable(): string | undefined {
  const fromEnvironment = process.env.KICKROCKS_TEST_BROWSER;
  if (fromEnvironment && existsSync(fromEnvironment)) return fromEnvironment;
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;

  const cache = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(cache)) {
    const newest = readdirSync(cache)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const name of newest) {
      const candidate = join(cache, name, "chrome-linux64", "chrome");
      if (existsSync(candidate)) return candidate;
    }
  }
  return [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((path) => existsSync(path));
}

export const browserAvailable = findBrowserExecutable() !== undefined;

/**
 * A suite that needs a real browser. It skips on a machine without one, so `pnpm test` works on a
 * laptop, and runs (and so fails when it cannot launch) when CI sets KICKROCKS_REQUIRE_INTEGRATION.
 */
export const describeBrowser = describe.skipIf(
  !browserAvailable && process.env.KICKROCKS_REQUIRE_INTEGRATION !== "1",
);

export function launchTestBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    ...(findBrowserExecutable() ? { executablePath: findBrowserExecutable() as string } : {}),
  });
}

/** Short waits, so a test that expects something not to appear does not take ten seconds. */
export const FAST: RunnerOptions = {
  pace: INSTANT_PACE,
  allowHttp: true,
  timeouts: {
    stepMs: 3000,
    optionalMs: 300,
    navigationMs: 10_000,
    outcomeSettleMs: 500,
    checkpointMs: 600,
    challengeGraceMs: 1800,
    resultsMs: 1200,
    runMs: 60_000,
  },
};

export interface RecipeSpec {
  origin: string;
  purpose?: RecipePurpose;
  entry: string;
  fields?: ProfileField[];
  steps: unknown[];
  canary?: {
    url?: string;
    selectors?: unknown[];
    entrySelectors?: unknown[];
    steps?: unknown[];
  };
}

/**
 * A remove recipe must end with proof that the site took the request. Most tests are about some
 * other step, so one that has no proof of its own gets a page-loaded check that always holds,
 * which keeps the outcome the test expects. A test of the proof itself writes its own.
 */
function withPageLoadedProof(spec: RecipeSpec): unknown[] {
  const email = spec.steps.some(
    (step) => (step as { kind?: string }).kind === "email_confirmation",
  );
  const proof = {
    kind: "outcome_when",
    when: [
      {
        selector: { css: "html" },
        outcome: email ? "awaiting_email_confirmation" : "submitted",
      },
    ],
  };
  return [...spec.steps, proof];
}

/** A valid recipe for the fixture site, written the way an author would write it. */
export function makeRecipe(spec: RecipeSpec): Recipe {
  const purpose = spec.purpose ?? "remove";
  const input: RecipeInput = {
    id: recipeId("fixture", purpose, 1),
    brokerId: "fixture",
    version: 1,
    purpose,
    entryUrl: `${spec.origin}${spec.entry}`,
    fields: spec.fields ?? [],
    steps: spec.steps as RecipeInput["steps"],
    canary: {
      url: `${spec.origin}${spec.canary?.url ?? spec.entry}`,
      selectors: (spec.canary?.selectors ?? [{ css: "body" }]) as never,
      entrySelectors: (spec.canary?.entrySelectors ?? []) as never,
      steps: (spec.canary?.steps ?? []) as never,
    },
  };
  const parsed = Recipe.safeParse(input);
  if (parsed.success) return parsed.data;
  if (purpose === "remove") {
    return Recipe.parse({ ...input, steps: withPageLoadedProof(spec) as RecipeInput["steps"] });
  }
  return Recipe.parse(input);
}

export const JORDAN = {
  first_name: "Jordan",
  last_name: "Example",
  full_name: "Jordan Example",
  email: "jordan@example.com",
  state: "TX",
  city: "Austin",
} as const;
