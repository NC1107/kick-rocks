import { RequestStatus, TaskStatus } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { formatRelative, pluralize } from "./format.js";
import * as labels from "./labels.js";
import { REQUEST_STATUS_META, TASK_STATUS_META } from "./status.js";
import { TONES } from "./tone.js";

describe("status metadata", () => {
  it("gives every request status words, a known tone, and an icon", () => {
    for (const status of RequestStatus.options) {
      const meta = REQUEST_STATUS_META[status];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(TONES).toContain(meta.tone);
      expect(meta.icon).toBeDefined();
    }
  });

  it("keeps request status labels distinct, so two pills never read the same", () => {
    const names = RequestStatus.options.map((status) => REQUEST_STATUS_META[status].label);
    expect(new Set(names).size).toBe(names.length);
  });

  it("separates statuses by hue or icon, so color is never the only signal", () => {
    const pairs = RequestStatus.options.map((status) => {
      const meta = REQUEST_STATUS_META[status];
      return `${meta.tone}:${meta.icon.displayName ?? meta.label}`;
    });
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("covers every task status", () => {
    for (const status of TaskStatus.options) {
      expect(TASK_STATUS_META[status].label.length).toBeGreaterThan(0);
    }
  });
});

describe("copy rules", () => {
  it("has no em dash, exclamation mark, or empty text in any label table", () => {
    const strings: string[] = [];
    for (const value of Object.values(labels)) {
      for (const text of Object.values(value)) if (typeof text === "string") strings.push(text);
    }
    for (const meta of [
      ...Object.values(REQUEST_STATUS_META),
      ...Object.values(TASK_STATUS_META),
    ]) {
      strings.push(meta.label, meta.description);
    }
    expect(strings.length).toBeGreaterThan(50);
    for (const text of strings) {
      expect(text).not.toBe("");
      expect(text).not.toMatch(/[—!]/);
    }
  });
});

describe("format", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");

  it("describes the recent past and the near future", () => {
    expect(formatRelative("2026-10-07T11:59:40Z", { now, locale: "en-US" })).toBe("just now");
    expect(formatRelative("2026-10-07T09:00:00Z", { now, locale: "en-US" })).toBe("3 hours ago");
    expect(formatRelative("2026-10-09T12:00:00Z", { now, locale: "en-US" })).toBe("in 2 days");
    expect(formatRelative("2026-08-01T12:00:00Z", { now, locale: "en-US" })).toBe("2 months ago");
  });

  it("pluralizes", () => {
    expect(pluralize(1, "request")).toBe("1 request");
    expect(pluralize(3, "request")).toBe("3 requests");
    expect(pluralize(2, "company", "companies")).toBe("2 companies");
  });
});
