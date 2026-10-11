import type { TargetOutcome } from "@kickrocks/shared";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { paths, taskPath } from "../../lib/paths.js";
import { describeScanStart } from "../../lib/scan-start.js";
import { renderPage } from "../../test/render.js";
import { HoldReason } from "./HoldReason.js";
import { describeHeldScans } from "./hold-text.js";

const outcome = (overrides: Partial<TargetOutcome>): TargetOutcome => ({
  targetId: "t",
  targetName: "T",
  outcome: "skipped",
  requestId: null,
  scanId: null,
  reason: null,
  detail: null,
  ...overrides,
});

describe("HoldReason", () => {
  it("says quiet hours are on the server clock when no time zone is set", async () => {
    renderPage(
      <HoldReason
        hold={{ reason: "quiet_hours", until: "2026-10-08T07:00:00.000Z", serverClock: true }}
      />,
    );
    expect(await screen.findByText(/server clock, no time zone set/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Set time zone" })).toHaveAttribute(
      "href",
      "/settings#scan-pace",
    );
  });

  it("names the missing detail and links to the profile", () => {
    renderPage(
      <HoldReason hold={{ reason: "missing_fields", fields: ["city"] }} profileId="prf_1" />,
    );
    expect(screen.getByText(/Skipped:/)).toBeVisible();
    expect(screen.getByText(/Profile has no city/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Edit profile" })).toHaveAttribute(
      "href",
      "/profiles/prf_1",
    );
  });

  it("links a cooling site to its target", () => {
    renderPage(
      <HoldReason
        hold={{
          reason: "site_cooldown",
          domain: "a.example",
          until: new Date(Date.now() + 5 * 3_600_000).toISOString(),
        }}
        targetId="tgt_a"
      />,
    );
    expect(screen.getByRole("link", { name: "a.example" })).toHaveAttribute(
      "href",
      "/targets/tgt_a",
    );
    expect(screen.getByText(/cooling down, 5h/)).toBeVisible();
  });
});

describe("describeHeldScans", () => {
  it("reads a single hold as one sentence", () => {
    const text = describeHeldScans(
      { queued: 3, held: 3, byReason: { quiet_hours: { count: 3 } } },
      7,
    );
    expect(text).toBe("3 scans held by quiet hours until 07:00");
  });

  it("is null when nothing is held", () => {
    expect(describeHeldScans({ queued: 1, held: 0, byReason: {} }, 7)).toBeNull();
  });
});

describe("describeScanStart", () => {
  it("reports each skip reason and links to the profile when details are missing", () => {
    const summary = describeScanStart(
      [
        outcome({ outcome: "scan_started" }),
        outcome({ reason: "scan_in_progress" }),
        outcome({ reason: "missing_profile_details" }),
        outcome({ reason: "missing_profile_details" }),
      ],
      "prf_1",
    );
    expect(summary.title).toBe("Started 1 scan");
    expect(summary.description).toBe("Held back: 1 already running, 2 need profile details.");
    expect(summary.action).toEqual({ to: "/profiles/prf_1", label: "Add details" });
  });
});

describe("paths", () => {
  it("builds filtered lists and settings anchors", () => {
    expect(paths.requests({ status: "sent", targetId: "a b" })).toBe(
      "/requests?status=sent&targetId=a+b",
    );
    expect(paths.settings("sites")).toBe("/settings#sites");
    expect(paths.settings("agents")).toBe("/settings/agents");
  });

  it("sends a blocked task to Review and a running one to its request", () => {
    expect(taskPath({ id: "t1", kind: "form", status: "blocked", requestId: "r1" })).toBe(
      "/review?item=blocked%3At1",
    );
    expect(taskPath({ id: "t1", kind: "form", status: "leased", requestId: "r1" })).toBe(
      "/requests/r1",
    );
  });
});
