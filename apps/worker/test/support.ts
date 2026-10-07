import { existsSync } from "node:fs";
import {
  type ClaimedTask,
  Recipe,
  type RecipeInput,
  type TargetSummary,
  type TaskSummary,
} from "@kickrocks/shared";
import { chromium } from "playwright";
import { describe } from "vitest";
import { findInstalledChrome } from "../src/browser.js";
import type { WorkerConfig } from "../src/config.js";
import { silentLogger } from "../src/logger.js";

export { silentLogger };

const browserAvailable =
  findInstalledChrome() !== null ||
  Boolean(process.env.KICKROCKS_CHROME_EXECUTABLE) ||
  existsSync(chromium.executablePath());

/**
 * A suite that needs a real browser. It skips on a machine without one, so `pnpm test` works on a
 * laptop, and runs (and so fails when it cannot launch) when CI sets KICKROCKS_REQUIRE_INTEGRATION.
 */
export const describeBrowser = describe.skipIf(
  !browserAvailable && process.env.KICKROCKS_REQUIRE_INTEGRATION !== "1",
);

export const TARGET: TargetSummary = {
  id: "fixture",
  kind: "broker",
  name: "Fixture Broker",
  category: "people-search",
  domain: "127.0.0.1",
  website: null,
  optOutUrl: null,
  privacyRightsUrl: null,
  searchUrl: null,
  contactMethod: "form",
  requiresId: false,
  requirements: [],
  priority: "normal",
  needsRecord: false,
  californiaRegistered: false,
  retired: false,
};

export function config(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    serverUrl: "http://127.0.0.1:1",
    token: "a-token-of-sixteen-chars",
    workerId: "test-worker",
    pollMs: 5,
    leaseMs: 60_000,
    chromeProfileDir: "/tmp/kickrocks-test-profile",
    headless: true,
    noSandbox: false,
    allowHttp: true,
    pace: "instant",
    chromeExecutable: null,
    proxyServer: null,
    logLevel: "error",
    ...overrides,
  };
}

export function recipeFor(
  origin: string,
  purpose: "scan" | "remove",
  extra: Partial<RecipeInput> = {},
): Recipe {
  const remove = {
    fields: ["email"],
    steps: [
      { kind: "fill", target: { label: "Email" }, field: "email" },
      { kind: "click", target: { role: "button", label: "Submit request" } },
      { kind: "expect_text", text: "Request received" },
    ],
  };
  const scan = {
    fields: ["first_name"],
    steps: [
      {
        kind: "extract_candidates",
        item: { css: ".result" },
        fields: { recordUrl: { css: "a", attr: "href" }, name: { css: "h3" } },
      },
    ],
  };
  return Recipe.parse({
    id: `fixture.${purpose}.v1`,
    brokerId: "fixture",
    version: 1,
    purpose,
    entryUrl: `${origin}/form`,
    canary: { url: `${origin}/form`, selectors: [{ label: "Email" }] },
    ...(purpose === "scan" ? scan : remove),
    ...extra,
  } as RecipeInput);
}

let counter = 0;

export function task<K extends ClaimedTask["kind"]>(
  kind: K,
  payload: Extract<ClaimedTask, { kind: K }>["payload"],
  overrides: Partial<ClaimedTask> = {},
): ClaimedTask {
  counter += 1;
  return {
    id: `task-${counter}`,
    kind,
    attempt: 1,
    leaseExpiresAt: "2026-10-07T00:05:00.000Z",
    payload,
    target: TARGET,
    recipe: null,
    fields: {},
    instructions: "",
    ...overrides,
  } as ClaimedTask;
}

export function summary(id: string): TaskSummary {
  return {
    id,
    kind: "form",
    status: "done",
    priority: 20,
    profileId: "p1",
    targetId: "fixture",
    targetName: "Fixture Broker",
    requestId: "r1",
    blockedReason: null,
    blockedDetail: null,
    blockedUrl: null,
    failureKind: null,
    failureStep: null,
    finishedBy: "test-worker",
    claimerKind: "builtin",
    usage: null,
    attempts: 1,
    maxAttempts: 3,
    lastError: null,
    hasScreenshot: false,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
  };
}
