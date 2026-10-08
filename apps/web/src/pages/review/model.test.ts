import type { ReviewQueue } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  ageLabel,
  buildEntries,
  canHandOff,
  canReportOutcome,
  firstBusyTab,
  instructionSteps,
  parseTab,
  pickEntry,
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

describe("the flat queue", () => {
  const queue = {
    ...empty,
    blockedTasks: [{ task: { id: "t1" } }, { task: { id: "t2" } }],
    matches: [{ id: "m1" }],
    messages: [{ id: "g1" }],
  } as unknown as ReviewQueue;
  const entries = buildEntries(queue);

  it("groups items by kind in a fixed order", () => {
    expect(entries.map((entry) => entry.key)).toEqual([
      "blocked:t1",
      "blocked:t2",
      "match:m1",
      "mail:g1",
    ]);
  });

  it("opens the named item, else the first of a named group, else the first", () => {
    const pick = (item: string | null, tab: string | null, lastIndex = 0) =>
      pickEntry(entries, { item, tab, lastIndex })?.key;
    expect(pick("match:m1", null)).toBe("match:m1");
    expect(pick(null, "mail")).toBe("mail:g1");
    expect(pick(null, null)).toBe("blocked:t1");
  });

  it("moves to the item now at the old position when the named one is gone", () => {
    expect(pickEntry(entries, { item: "blocked:gone", tab: null, lastIndex: 2 })?.key).toBe(
      "match:m1",
    );
    expect(pickEntry(entries, { item: "blocked:gone", tab: null, lastIndex: 9 })?.key).toBe(
      "mail:g1",
    );
    expect(pickEntry([], { item: "x", tab: null, lastIndex: 0 })).toBeNull();
  });
});

describe("how long an item has waited", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  it("reads in the largest whole unit", () => {
    expect(ageLabel("2026-10-07T11:59:40Z", now)).toBe("now");
    expect(ageLabel("2026-10-07T11:55:00Z", now)).toBe("5m");
    expect(ageLabel("2026-10-07T09:00:00Z", now)).toBe("3h");
    expect(ageLabel("2026-10-04T12:00:00Z", now)).toBe("3d");
  });
});
