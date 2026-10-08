import { describe, expect, it } from "vitest";
import { shortRelative } from "../../lib/format.js";
import { gutterTime } from "./format.js";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ahead = (ms: number) => new Date(NOW + ms).toISOString();

describe("shortRelative", () => {
  it("reads the past in the smallest unit that fits", () => {
    expect(shortRelative(ago(10_000), NOW)).toBe("now");
    expect(shortRelative(ago(7 * MINUTE), NOW)).toBe("7m ago");
    expect(shortRelative(ago(2 * HOUR), NOW)).toBe("2h ago");
    expect(shortRelative(ago(DAY), NOW)).toBe("yesterday");
    expect(shortRelative(ago(5 * DAY), NOW)).toBe("5d ago");
    expect(shortRelative(ago(21 * DAY), NOW)).toBe("3w ago");
    expect(shortRelative(ago(90 * DAY), NOW)).toBe("3mo ago");
  });

  it("reads the future the same way, with next month for a distant due date", () => {
    expect(shortRelative(ahead(DAY), NOW)).toBe("tomorrow");
    expect(shortRelative(ahead(12 * DAY), NOW)).toBe("in 12d");
    expect(shortRelative(ahead(45 * DAY), NOW)).toBe("next month");
  });
});

describe("gutterTime", () => {
  it("shows a clock time for today and a date for an earlier day", () => {
    const today = new Date(NOW);
    today.setHours(9, 2, 0, 0);
    expect(gutterTime(today.toISOString(), today.getTime())).toBe("09:02");
    expect(gutterTime(ago(3 * DAY), NOW)).toMatch(/Oct/);
  });

  it("adds the year for an earlier year", () => {
    expect(gutterTime("2025-03-02T12:00:00Z", NOW)).toMatch(/2025/);
  });
});
