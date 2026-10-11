import { describe, expect, it } from "vitest";
import {
  clip,
  clockLeft,
  effortLabel,
  effortShort,
  maskValue,
  neighbour,
  openedRecently,
  pickKey,
  progressOf,
  snoozedLine,
  snoozePresets,
} from "./model.js";

/** Built from local parts, so the tests mean the same thing in whatever time zone they run. */
const local = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute, 0, 0);

describe("snooze presets", () => {
  it("offers an hour, tonight at 6 PM, tomorrow at 9 AM and Monday at 9 AM", () => {
    const now = local(2026, 10, 7, 14, 30);
    const presets = snoozePresets(now);
    expect(presets.map((preset) => preset.id)).toEqual(["hour", "tonight", "tomorrow", "week"]);
    expect(presets[0]?.until.getTime()).toBe(now.getTime() + 3_600_000);
    expect(presets[1]?.until).toEqual(local(2026, 10, 7, 18));
    expect(presets[2]?.until).toEqual(local(2026, 10, 8, 9));
    expect(presets[3]?.until).toEqual(local(2026, 10, 12, 9));
  });

  it("leaves tonight out once it is past 6 PM", () => {
    const ids = snoozePresets(local(2026, 10, 7, 19)).map((preset) => preset.id);
    expect(ids).toEqual(["hour", "tomorrow", "week"]);
  });

  it("takes the next Monday, not today, when today is a Monday", () => {
    const monday = local(2026, 10, 12, 8);
    expect(snoozePresets(monday).find((preset) => preset.id === "week")?.until).toEqual(
      local(2026, 10, 19, 9),
    );
  });

  it("crosses a month end", () => {
    const now = local(2026, 10, 31, 10);
    expect(snoozePresets(now).find((preset) => preset.id === "tomorrow")?.until).toEqual(
      local(2026, 11, 1, 9),
    );
  });
});

describe("snoozedLine", () => {
  const now = local(2026, 10, 7, 14, 30);

  it("names the hour, with minutes only when there are some", () => {
    expect(snoozedLine(local(2026, 10, 8, 9), now)).toBe("Snoozed till 9 AM");
    expect(snoozedLine(local(2026, 10, 7, 15, 42), now)).toBe("Snoozed till 3:42 PM");
    expect(snoozedLine(local(2026, 10, 7, 18), now)).toBe("Snoozed till 6 PM");
  });

  it("adds the weekday once it is further off than tomorrow", () => {
    expect(snoozedLine(local(2026, 10, 12, 9), now)).toBe("Snoozed till Mon 9 AM");
  });
});

describe("maskValue", () => {
  it("keeps the first letter and the domain of an email address", () => {
    expect(maskValue("email", "jordan@example.com")).toBe("j•••@example.com");
  });

  it("keeps the last four digits of a phone number", () => {
    expect(maskValue("phone", "(555) 555-0123")).toBe("•••-•••-0123");
  });

  it("keeps the year of a date of birth", () => {
    expect(maskValue("date_of_birth", "1990-04-12")).toBe("1990-••-••");
  });

  it("keeps the first letter of each word of a name", () => {
    expect(maskValue("full_name", "Jordan Q Example")).toBe("J••• Q••• E•••");
  });
});

describe("progress", () => {
  it("counts what was done this sitting plus the one open, over everything", () => {
    expect(progressOf(2, 6)).toEqual({ done: 2, total: 8, position: 3 });
  });

  it("never reads past the end, and grows when items arrive", () => {
    expect(progressOf(3, 0)).toEqual({ done: 3, total: 3, position: 3 });
    expect(progressOf(3, 5).total).toBe(8);
    expect(progressOf(0, 0).position).toBe(1);
  });
});

describe("moving through the queue", () => {
  const keys = ["a", "b", "c"];

  it("goes to the next and the previous, wrapping at the ends", () => {
    expect(neighbour(keys, "a", 1)).toBe("b");
    expect(neighbour(keys, "c", 1)).toBe("a");
    expect(neighbour(keys, "a", -1)).toBe("c");
    expect(neighbour([], "a", 1)).toBeNull();
  });

  it("starts at an end when the current one is gone", () => {
    expect(neighbour(keys, "gone", 1)).toBe("a");
    expect(neighbour(keys, "gone", -1)).toBe("c");
  });

  it("opens the named item, else the one now at the old position", () => {
    expect(pickKey(keys, "b", 0)).toBe("b");
    expect(pickKey(keys, "gone", 1)).toBe("b");
    expect(pickKey(keys, null, 9)).toBe("c");
    expect(pickKey([], "a", 0)).toBeNull();
  });
});

describe("the return prompt on load", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");

  it("asks about a page opened less than two hours ago", () => {
    expect(openedRecently({ openedAt: "2026-10-07T11:00:00Z" }, now)).toBe(true);
    expect(openedRecently({ openedAt: "2026-10-07T09:59:00Z" }, now)).toBe(false);
    expect(openedRecently({ openedAt: null }, now)).toBe(false);
  });
});

describe("small labels", () => {
  it("writes the time an item takes", () => {
    expect(effortLabel(0.25)).toBe("~15 sec");
    expect(effortLabel(2)).toBe("~2 min");
    expect(effortShort(0.5)).toBe("~30s");
    expect(effortShort(5)).toBe("~5m");
  });

  it("counts down a hold as minutes and seconds", () => {
    const now = Date.parse("2026-10-07T12:00:00Z");
    expect(clockLeft("2026-10-07T12:07:58Z", now)).toBe("7:58");
    expect(clockLeft("2026-10-07T11:59:00Z", now)).toBe("0:00");
    expect(clockLeft(null, now)).toBeNull();
  });

  it("cuts a long value", () => {
    expect(clip("abcdefghijklmnop", 5)).toBe("abcde…");
    expect(clip("short", 12)).toBe("short");
  });
});
