import type { ReviewQueue } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  canHandOff,
  canReportOutcome,
  firstBusyTab,
  instructionSteps,
  parseTab,
  tabCounts,
} from "./model.js";

const empty: ReviewQueue = {
  blockedTasks: [],
  matches: [],
  verifications: [],
  failedTasks: [],
  agentTasks: [],
  messages: [],
  waitingTasks: [],
};

describe("instructionSteps", () => {
  it("splits a paragraph into one step per sentence", () => {
    expect(instructionSteps("Open the page. Solve the CAPTCHA! Then mark it done.")).toEqual([
      "Open the page.",
      "Solve the CAPTCHA!",
      "Then mark it done.",
    ]);
  });

  it("uses lines when there are several and drops their numbering", () => {
    expect(instructionSteps("1. Open the page.\n2) Sign in.\n- Finish it.")).toEqual([
      "Open the page.",
      "Sign in.",
      "Finish it.",
    ]);
  });

  it("returns no steps for empty text", () => {
    expect(instructionSteps("  ")).toEqual([]);
  });
});

describe("review tabs", () => {
  it("reads a tab name and rejects anything else", () => {
    expect(parseTab("matches")).toBe("matches");
    expect(parseTab("nonsense")).toBeNull();
    expect(parseTab(null)).toBeNull();
  });

  it("opens the first tab that has something in it, else blocked", () => {
    expect(firstBusyTab(empty)).toBe("blocked");
    const queue = { ...empty, messages: [{}] } as unknown as ReviewQueue;
    expect(firstBusyTab(queue)).toBe("mail");
    expect(tabCounts(queue).mail).toBe(1);
  });
});

describe("what a person can do with a task", () => {
  it("hands only website tasks to an agent", () => {
    expect(canHandOff({ kind: "form" })).toBe(true);
    expect(canHandOff({ kind: "email_send" })).toBe(false);
    expect(canHandOff({ kind: "confirm" })).toBe(false);
  });

  it("reports a removal outcome only for a task that belongs to a request", () => {
    expect(canReportOutcome({ kind: "form", requestId: "req_1" })).toBe(true);
    expect(canReportOutcome({ kind: "agent", requestId: null })).toBe(false);
    expect(canReportOutcome({ kind: "scan", requestId: null })).toBe(false);
  });
});
