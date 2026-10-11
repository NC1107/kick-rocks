import type { BlockedTaskItem, ReviewQueue, TaskAssignment } from "@kickrocks/shared";
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
  sentWithoutApproval,
  splitByBand,
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
  waitingTotal: 0,
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

  it("treats a form reported sent without an approval as one to check, not to run again", () => {
    const blocked = { kind: "agent", status: "blocked" } as const;
    expect(sentWithoutApproval({ ...blocked, blockedReason: "unapproved_submit" })).toBe(true);
    expect(sentWithoutApproval({ ...blocked, blockedReason: "approval_needed" })).toBe(false);
    expect(
      sentWithoutApproval({ kind: "form", status: "blocked", blockedReason: "unapproved_submit" }),
    ).toBe(false);
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

  it("keeps a task selected when it moves between sections", () => {
    const task = (id: string) => ({ task: { id, assignment: null } }) as unknown as BlockedTaskItem;
    const queue: ReviewQueue = {
      ...empty,
      agentTasks: [
        { task: { id: "a", assignment: { to: { kind: "person" } } } } as unknown as BlockedTaskItem,
        task("b"),
      ],
    };
    const moved = buildEntries(queue);
    const pick = (item: string) => pickEntry(moved, { item, tab: null, lastIndex: 1 })?.key;
    expect(pick("agent:a")).toBe("yours:a");
    expect(pick("yours:b")).toBe("agent:b");
    expect(pick("agent:gone")).toBe("agent:b");
    expect(pick("match:a")).toBe("agent:b");
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

describe("tasks assigned to the person", () => {
  const item = (id: string, to?: TaskAssignment["to"]): BlockedTaskItem =>
    ({
      task: {
        id,
        assignment: to ? { to, at: "2026-10-11T00:00:00.000Z", by: "user", fallback: "any" } : null,
      },
    }) as unknown as BlockedTaskItem;
  const queue: ReviewQueue = {
    ...empty,
    agentTasks: [
      item("open"),
      item("mine", { kind: "person" }),
      item("pinned", { kind: "model", workerId: "nick-pc-agent" }),
    ],
  };

  it("moves them out of Waiting for an agent into Yours to do, after Blocked", () => {
    const entries = buildEntries({ ...queue, blockedTasks: [item("held")] });
    expect(entries.map((entry) => [entry.kind, entry.key])).toEqual([
      ["blocked", "blocked:held"],
      ["yours", "yours:mine"],
      ["agents", "agent:open"],
      ["agents", "agent:pinned"],
    ]);
  });

  it("counts them in their own tab and keeps the agent tab to what an agent may take", () => {
    expect(tabCounts(queue)).toMatchObject({ yours: 1, agents: 2 });
    expect(firstBusyTab({ ...empty, agentTasks: [item("mine", { kind: "person" })] })).toBe(
      "yours",
    );
  });
});

describe("splitByBand", () => {
  const at = (band: "likely" | "maybe" | "unlikely" | null, id: string) => ({
    id,
    assessment: band ? { band, score: 0, reasons: [] } : null,
  });

  it("puts likely first, then maybe, then unscored, and folds unlikely away", () => {
    const { shown, unlikely } = splitByBand([
      at("unlikely", "a"),
      at(null, "b"),
      at("maybe", "c"),
      at("likely", "d"),
    ]);
    expect(shown.map((item) => item.id)).toEqual(["d", "c", "b"]);
    expect(unlikely.map((item) => item.id)).toEqual(["a"]);
  });
});
