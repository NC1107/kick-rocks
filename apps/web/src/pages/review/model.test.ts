import type { BlockedTaskItem, ReviewQueue, TaskAssignment } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  ageLabel,
  buildEntries,
  canHandOff,
  canReportOutcome,
  pickEntry,
  sectionCounts,
  splitByBand,
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
    messages: [{ id: "g1" }, { id: "g2" }],
    failedTasks: [{ task: { id: "f1", lastError: null, failureKind: null } }],
    agentTasks: [{ task: { id: "a1", assignment: null } }],
  } as unknown as ReviewQueue;
  const entries = buildEntries(queue);

  it("groups rows by kind in a fixed order", () => {
    expect(entries.map((entry) => entry.key)).toEqual([
      "mail:g1",
      "mail:g2",
      "failed:f1",
      "agent:a1",
    ]);
  });

  it("opens the named item, else the one at the old position", () => {
    const pick = (item: string | null, lastIndex = 0) =>
      pickEntry(entries, { item, lastIndex })?.key;
    expect(pick("failed:f1")).toBe("failed:f1");
    expect(pick(null)).toBe("mail:g1");
    expect(pick("mail:gone", 2)).toBe("failed:f1");
    expect(pick("mail:gone", 9)).toBe("agent:a1");
    expect(pickEntry([], { item: "x", lastIndex: 0 })).toBeNull();
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

  it("leaves the ones the person took to the Needs you queue", () => {
    const entries = buildEntries(queue);
    expect(entries.map((entry) => [entry.kind, entry.key])).toEqual([
      ["agents", "agent:open"],
      ["agents", "agent:pinned"],
    ]);
  });

  it("keeps the Agents count to what an agent may take", () => {
    expect(sectionCounts(queue)).toMatchObject({ agents: 2, mail: 0, problems: 0 });
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
