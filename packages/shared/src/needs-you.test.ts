import { describe, expect, it } from "vitest";
import {
  kindOfTask,
  NEEDS_YOU_EFFORT,
  type NeedsYouItem,
  NeedsYouKind,
  needsYouCounts,
  orderNeedsYou,
} from "./needs-you.js";
import { BlockedReason, isPersonOnlyBlock } from "./outcomes.js";

const NOW = new Date("2026-10-10T12:00:00.000Z");

function item(key: string, overrides: Partial<NeedsYouItem> = {}): NeedsYouItem {
  const kind = overrides.kind ?? "captcha";
  return {
    key,
    kind,
    order: 0,
    effort: NEEDS_YOU_EFFORT[kind],
    since: "2026-10-09T12:00:00.000Z",
    expiresAt: null,
    tries: 0,
    lastTriedAt: null,
    openedAt: null,
    target: null,
    requestReference: null,
    url: null,
    chips: [],
    source: {} as NeedsYouItem["source"],
    ...overrides,
  };
}

const orderOf = (items: NeedsYouItem[]) => orderNeedsYou(items, NOW).map((entry) => entry.key);

describe("orderNeedsYou", () => {
  it("puts holds first, the soonest to run out leading", () => {
    const later = item("task:later", { kind: "hold", expiresAt: "2026-10-10T12:08:00.000Z" });
    const sooner = item("task:sooner", { kind: "hold", expiresAt: "2026-10-10T12:02:00.000Z" });
    expect(orderOf([item("match:a", { kind: "record" }), later, sooner])).toEqual([
      "task:sooner",
      "task:later",
      "match:a",
    ]);
  });

  it("does not put a hold that has run out ahead of the rest", () => {
    const expired = item("task:gone", { kind: "hold", expiresAt: "2026-10-10T11:00:00.000Z" });
    expect(orderOf([item("task:a", { kind: "login" }), expired])).toEqual(["task:gone", "task:a"]);
  });

  it("puts quick before a few minutes before longer", () => {
    expect(
      orderOf([
        item("a", { kind: "login" }),
        item("b", { kind: "captcha" }),
        item("c", { kind: "record" }),
      ]),
    ).toEqual(["c", "b", "a"]);
  });

  it("puts what was marked Not yet after untried items of the same band", () => {
    expect(
      orderOf([
        item("old", { tries: 1, since: "2026-10-01T00:00:00.000Z" }),
        item("new", { since: "2026-10-09T00:00:00.000Z" }),
      ]),
    ).toEqual(["new", "old"]);
  });

  it("puts the oldest first within a band", () => {
    expect(
      orderOf([
        item("b", { since: "2026-10-09T00:00:00.000Z" }),
        item("a", { since: "2026-10-08T00:00:00.000Z" }),
      ]),
    ).toEqual(["a", "b"]);
  });

  it("is stable: the same items in any input order give the same order", () => {
    const items = [item("c"), item("a"), item("b")];
    expect(orderOf(items)).toEqual(["a", "b", "c"]);
    expect(orderOf([...items].reverse())).toEqual(["a", "b", "c"]);
  });

  it("numbers the result from 0 without changing the input", () => {
    const items = [item("b"), item("a")];
    const result = orderNeedsYou(items, NOW);
    expect(result.map((entry) => entry.order)).toEqual([0, 1]);
    expect(items.map((entry) => entry.order)).toEqual([0, 0]);
  });
});

describe("kindOfTask", () => {
  const idle = { assignment: null, blockedReason: null };

  it("maps every blocked reason", () => {
    const expected: Record<BlockedReason, NeedsYouKind> = {
      captcha: "captcha",
      phone_verification: "phone_code",
      id_upload: "id",
      email_verification: "email_link",
      login_required: "login",
      bot_detection: "bot",
      approval_needed: "approve",
      unapproved_submit: "check_sent",
      unknown: "by_hand",
    };
    for (const reason of BlockedReason.options) {
      expect(kindOfTask({ ...idle, status: "blocked", blockedReason: reason })).toBe(
        expected[reason],
      );
    }
  });

  it("treats a blocked task with no reason as by hand", () => {
    expect(kindOfTask({ ...idle, status: "blocked" })).toBe("by_hand");
  });

  it("maps a leased task to a hold and a task taken by the person to by hand", () => {
    expect(kindOfTask({ ...idle, status: "leased" })).toBe("hold");
    const mine = { to: { kind: "person" }, at: "", by: "user", fallback: "any" } as const;
    expect(kindOfTask({ ...idle, status: "queued", assignment: mine })).toBe("by_hand");
  });

  it("leaves out failed tasks and tasks waiting for an agent", () => {
    expect(kindOfTask({ ...idle, status: "failed" })).toBeNull();
    expect(kindOfTask({ ...idle, status: "queued" })).toBeNull();
    const worker = {
      to: { kind: "model", workerId: "w" },
      at: "",
      by: "user",
      fallback: "any",
    } as const;
    expect(kindOfTask({ ...idle, status: "queued", assignment: worker })).toBeNull();
  });
});

describe("NEEDS_YOU_EFFORT", () => {
  it("covers every kind with a positive time", () => {
    for (const kind of NeedsYouKind.options) {
      expect(NEEDS_YOU_EFFORT[kind].minutes).toBeGreaterThan(0);
    }
  });
});

describe("needsYouCounts", () => {
  it("adds up what it is given and rounds the minutes up", () => {
    const items = [
      item("a", { kind: "hold" }),
      item("b", { kind: "captcha" }),
      item("c", { kind: "id" }),
    ];
    expect(needsYouCounts(items, 2)).toEqual({
      active: 3,
      snoozed: 2,
      minutes: 8,
      quick: 1,
      few: 1,
      longer: 1,
    });
  });

  it("is empty for nothing", () => {
    expect(needsYouCounts([])).toEqual({
      active: 0,
      snoozed: 0,
      minutes: 0,
      quick: 0,
      few: 0,
      longer: 0,
    });
  });
});

describe("isPersonOnlyBlock", () => {
  it("names the blocks an agent cannot pass and no others", () => {
    const refused = BlockedReason.options.filter((reason) => isPersonOnlyBlock(reason));
    expect(refused).toEqual(["phone_verification", "id_upload"]);
    expect(isPersonOnlyBlock(null)).toBe(false);
  });
});
