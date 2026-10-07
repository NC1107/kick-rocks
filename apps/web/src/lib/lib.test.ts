import { RequestStatus, TaskStatus } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import themeInit from "../../public/theme-init.js?raw";
import { formatRelative, formatShortAgo, pluralize } from "./format.js";
import * as labels from "./labels.js";
import { REQUEST_STATUS_META, TASK_STATUS_META } from "./status.js";
import { STORAGE_KEYS } from "./storage.js";

const FAMILY_SHAPE = {
  resolved: "disc",
  needs: "triangle",
  failed: "square",
  closed: "dash",
} as const;

describe("formatShortAgo", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  it.each([
    ["2026-10-07T11:59:40Z", "now"],
    ["2026-10-07T11:53:00Z", "7m ago"],
    ["2026-10-07T10:00:00Z", "2h ago"],
    ["2026-10-04T12:00:00Z", "3d ago"],
    ["2026-10-07T12:05:00Z", "now"],
  ])("reads %s as %s", (iso, expected) => {
    expect(formatShortAgo(iso, now)).toBe(expected);
  });
});

describe("status metadata", () => {
  it("gives every request status words, a family, and a shape", () => {
    for (const status of RequestStatus.options) {
      const meta = REQUEST_STATUS_META[status];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.family).toBeTruthy();
      expect(meta.shape).toBeTruthy();
    }
  });

  it("keeps request status labels distinct, so two marks never read the same", () => {
    const names = RequestStatus.options.map((status) => REQUEST_STATUS_META[status].label);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives each outcome family its own shape, so color is never the only signal", () => {
    for (const meta of [
      ...Object.values(REQUEST_STATUS_META),
      ...Object.values(TASK_STATUS_META),
    ]) {
      const expected = FAMILY_SHAPE[meta.family as keyof typeof FAMILY_SHAPE];
      if (expected) expect(meta.shape).toBe(expected);
    }
  });

  it("draws a waiting request as a ring, and only a running task as a moving one", () => {
    for (const meta of Object.values(REQUEST_STATUS_META)) {
      if (meta.family === "progress")
        expect(["ring", "ring-dot", "dashed-ring"]).toContain(meta.shape);
    }
    expect(TASK_STATUS_META.leased.shape).toBe("running");
  });

  it("covers every task status", () => {
    for (const status of TaskStatus.options) {
      expect(TASK_STATUS_META[status].label.length).toBeGreaterThan(0);
    }
  });
});

// Written by code point so this file does not contain the character it forbids.
const EM_DASH = String.fromCodePoint(0x2014);

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
      expect(text).not.toContain(EM_DASH);
      expect(text).not.toContain("!");
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

describe("theme-init.js", () => {
  it("reads the same storage key the app writes", () => {
    expect(themeInit).toContain(`"${STORAGE_KEYS.theme}"`);
  });
});
