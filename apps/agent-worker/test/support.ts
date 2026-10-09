import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaimedTask, ProfileFields, TargetSummary, TaskSummary } from "@kickrocks/shared";
import {
  chromeArgs,
  findInstalledChrome,
  NO_SIGNAL_HANDLERS,
  turnOffPreloading,
} from "@kickrocks/worker/dist/browser.js";
import { silentLogger } from "@kickrocks/worker/dist/logger.js";
import { type Browser, chromium } from "playwright";
import { describe } from "vitest";
import type { AgentTask } from "../src/loop.js";
import type {
  Message,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelUsage,
  ToolCall,
} from "../src/provider.js";
import { type FixtureState, ORIGIN } from "./fixtures/server.js";

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

/**
 * A Chrome started the way production starts it: its own profile with preloading turned off and
 * the same switches. Playwright's plain launch uses a profile of its own that a setting cannot
 * be written into, so the browser comes from a persistent context and closing it removes the profile.
 */
export async function launchTestBrowser(): Promise<Browser> {
  const executablePath = process.env.KICKROCKS_CHROME_EXECUTABLE ?? findInstalledChrome();
  const profileDir = mkdtempSync(join(tmpdir(), "kickrocks-chrome-"));
  turnOffPreloading(profileDir);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    ...NO_SIGNAL_HANDLERS,
    args: [`--host-resolver-rules=MAP other.test 127.0.0.1`, ...chromeArgs({ noSandbox: false })],
    ...(executablePath ? { executablePath } : {}),
  });
  const browser = context.browser();
  if (browser === null) throw new Error("the test browser has no browser to hand out");
  const close = browser.close.bind(browser);
  browser.close = async (options) => {
    await close(options);
    rmSync(profileDir, { recursive: true, force: true });
  };
  return browser;
}

export const TARGET: TargetSummary = {
  id: "fixture",
  kind: "broker",
  name: "Fixture Broker",
  category: "people-search",
  domain: "127.0.0.1",
  website: null,
  optOutUrl: `${ORIGIN}/optout`,
  privacyRightsUrl: null,
  searchUrl: `${ORIGIN}/search`,
  contactMethod: "form",
  requiresId: false,
  requirements: [],
  priority: "normal",
  needsRecord: false,
  californiaRegistered: false,
  difficulty: "easy",
  difficultyReasons: ["email", "no_record_needed"],
  retired: false,
};

export const PERSON: ProfileFields = {
  first_name: "Jordan",
  last_name: "Example",
  email: "jordan.example@example.com",
  state: "TX",
};

let counter = 0;

export function agentTask(
  overrides: Partial<Omit<AgentTask, "kind" | "payload">> & {
    payload?: Partial<AgentTask["payload"]>;
  } = {},
): AgentTask {
  counter += 1;
  const { payload, ...rest } = overrides;
  return {
    id: `agent-task-${counter}`,
    kind: "agent",
    attempt: 1,
    leaseExpiresAt: "2026-10-07T00:05:00.000Z",
    profileId: "profile-1",
    target: TARGET,
    recipe: null,
    fields: PERSON,
    submitApproval: "not_needed",
    instructions:
      "Task: Remove this person from Fixture Broker. Complete the opt-out form using only the identifiers in fields.",
    payload: {
      purpose: "remove",
      profileId: "profile-1",
      targetId: "fixture",
      requestId: "request-1",
      recordUrl: null,
      variant: null,
      rights: ["opt_out"],
      reason: "no_recipe",
      previousError: null,
      blockedReason: null,
      ...payload,
    },
    ...rest,
  } as AgentTask;
}

export function summary(id: string): TaskSummary {
  return {
    id,
    kind: "agent",
    status: "done",
    priority: 20,
    profileId: "profile-1",
    targetId: "fixture",
    targetName: "Fixture Broker",
    requestId: "request-1",
    blockedReason: null,
    blockedDetail: null,
    blockedUrl: null,
    failureKind: null,
    failureStep: null,
    finishedBy: "test-agent",
    claimerKind: "model",
    usage: null,
    attempts: 1,
    maxAttempts: 3,
    lastError: null,
    hasScreenshot: false,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
  };
}

export async function fixtureState(): Promise<FixtureState> {
  return (await (await fetch(`${ORIGIN}/__state`)).json()) as FixtureState;
}

export async function resetFixture(): Promise<void> {
  await fetch(`${ORIGIN}/__reset`);
}

export type CallSpec = [name: string, args?: unknown];

export interface Turn {
  text?: string;
  calls?: CallSpec[];
  usage?: ModelUsage;
}

/** What the scripted model reads from the conversation so far, as a real model would. */
export interface View {
  /** The latest page snapshot it was given. */
  snapshot: string;
  /** The ref of the control whose name contains the text. */
  ref(label: string): string;
  /** Everything sent to the model so far, as text. */
  transcript: string;
}

export type Step = Turn | ((view: View) => Turn);

export interface ScriptedProvider extends ModelProvider {
  /** Copies of every request, taken when it was made. */
  readonly requests: ModelRequest[];
}

function textOf(messages: Message[]): string {
  return messages
    .map((message) => {
      if (message.role === "user") return message.text;
      if (message.role === "assistant")
        return `${message.text} ${JSON.stringify(message.toolCalls)}`;
      return message.results.map((r) => r.content).join("\n");
    })
    .join("\n");
}

function lastSnapshot(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "tool") continue;
    for (const result of [...message.results].reverse()) {
      if (result.content.includes("<page>")) return result.content;
    }
  }
  return "";
}

function viewOf(request: ModelRequest): View {
  const snapshot = lastSnapshot(request.messages);
  return {
    snapshot,
    transcript: textOf(request.messages),
    ref(label) {
      const line = snapshot
        .split("\n")
        .find((candidate) => /^\[e\d+\]/.test(candidate) && candidate.includes(label));
      const ref = line?.match(/^\[(e\d+)\]/)?.[1];
      if (!ref) throw new Error(`No control named ${label} in:\n${snapshot}`);
      return ref;
    },
  };
}

/** A model that follows a script, so a test decides exactly what it does at each turn. */
export function scripted(
  steps: Step[],
  usage: ModelUsage = { inputTokens: 100, outputTokens: 20 },
): ScriptedProvider {
  const requests: ModelRequest[] = [];
  let turn = 0;
  let callNumber = 0;
  return {
    name: "scripted",
    model: "scripted-model",
    requests,
    async complete(request): Promise<ModelResponse> {
      requests.push({ ...request, messages: structuredClone(request.messages) });
      const step = steps[turn];
      turn += 1;
      if (step === undefined) throw new Error("The scripted model ran out of turns");
      const resolved = typeof step === "function" ? step(viewOf(request)) : step;
      const toolCalls: ToolCall[] = (resolved.calls ?? []).map(([name, args]) => {
        callNumber += 1;
        return { id: `call_${callNumber}`, name, args: args ?? {} };
      });
      return { text: resolved.text ?? "", toolCalls, usage: resolved.usage ?? usage };
    },
  };
}

export type { ClaimedTask };
