import type { Dashboard, TargetOutcome } from "@kickrocks/shared";
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

  it("gives a hold one time and a link named for what it opens", () => {
    renderPage(
      <HoldReason
        hold={{
          reason: "site_cooldown",
          until: new Date(Date.now() + 5 * 3_600_000).toISOString(),
        }}
      />,
    );
    expect(screen.getByText(/Sites cooling down until/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Site settings" })).toHaveAttribute(
      "href",
      "/settings#sites",
    );
    expect(screen.queryByText(/\b5h\b/)).toBeNull();
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
    expect(screen.getByText(/cooling down until/)).toBeVisible();
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

describe("describeScanStart with what the profile can be scanned on", () => {
  const scanning = (overrides: Partial<Dashboard["scanning"]>): Dashboard["scanning"] => ({
    ready: 0,
    noRecipe: 0,
    recipeNeedsReview: 0,
    needsDetails: 0,
    missing: null,
    quiet: null,
    ...overrides,
  });
  const queued = (count: number) =>
    Array.from({ length: count }, () => outcome({ outcome: "scan_started" }));

  it("says nothing can run, and why, instead of announcing a start", () => {
    const summary = describeScanStart(
      queued(59),
      "prf_1",
      scanning({
        ready: 9,
        noRecipe: 50,
        quiet: { until: "2026-10-08T07:00:00.000Z", zoneUnset: false },
      }),
    );
    expect(summary.intent).toBe("info");
    expect(summary.title).toBe(
      "Queued 59, none can run now: 50 need an agent, 9 wait for quiet hours",
    );
  });

  it("names a recipe that waits for review apart from a missing one", () => {
    const summary = describeScanStart(
      queued(5),
      "prf_1",
      scanning({ noRecipe: 3, recipeNeedsReview: 2 }),
    );
    expect(summary.title).toBe(
      "Queued 5, none can run now: 3 need an agent, 2 wait for a recipe review",
    );
  });

  it("still reports a plain start while some scans can run", () => {
    const summary = describeScanStart(queued(4), "prf_1", scanning({ ready: 2, noRecipe: 2 }));
    expect(summary).toMatchObject({ intent: "success", title: "Started 4 scans" });
  });

  it("puts what to add in the title when no scan could start", () => {
    const summary = describeScanStart(
      [outcome({ reason: "missing_profile_details" })],
      "prf_1",
      scanning({ needsDetails: 59, missing: "a current address with city" }),
    );
    expect(summary).toMatchObject({
      intent: "info",
      title: "No scans started. Add a current address with city",
      action: { to: "/profiles/prf_1", label: "Add details" },
    });
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
      "/review?item=task%3At1",
    );
    expect(taskPath({ id: "t1", kind: "form", status: "leased", requestId: "r1" })).toBe(
      "/requests/r1",
    );
  });
});
