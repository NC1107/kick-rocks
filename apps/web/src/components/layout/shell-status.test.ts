import type { SettingsView } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  inboxChip,
  mostUrgent,
  sendsChip,
  sitesChip,
  versionLabel,
  workerChip,
} from "./shell-status.js";

const NOW = Date.parse("2026-10-07T12:00:00Z");

function status(lastSeenAt: string): NonNullable<SettingsView["worker"]["builtin"]> {
  return { workerId: "w", version: null, lastSeenAt, busy: false, currentTaskId: null };
}

describe("shell status chips", () => {
  it("calls a worker that checked in a minute ago online", () => {
    const chip = workerChip(
      { enabled: true, builtin: status("2026-10-07T11:59:00Z"), model: null },
      NOW,
    );
    expect(chip).toMatchObject({ tone: "positive", label: "Worker online" });
  });

  it("flags a worker that went quiet as attention", () => {
    const chip = workerChip(
      { enabled: true, builtin: status("2026-10-07T11:00:00Z"), model: null },
      NOW,
    );
    expect(chip.tone).toBe("attention");
  });

  it("stays neutral when no worker was ever set up", () => {
    expect(workerChip({ enabled: false, builtin: null, model: null }, NOW).tone).toBe("neutral");
  });

  it("puts an inbox error ahead of the last check time", () => {
    const chip = inboxChip(
      { address: "a@example.com", lastPolledAt: "2026-10-07T11:59:00Z", lastError: "refused" },
      () => "1m ago",
    );
    expect(chip).toMatchObject({ tone: "attention", label: "Inbox unreachable" });
  });

  it("turns the sends chip to attention at 80 percent of the cap", () => {
    expect(sendsChip({ sent: 119, cap: 150, remaining: 31 })?.tone).toBe("neutral");
    expect(sendsChip({ sent: 120, cap: 150, remaining: 30 })?.tone).toBe("attention");
    expect(sendsChip(null)).toBeNull();
  });

  it("picks a chip for the phone bar only when something needs a look", () => {
    const fine = [{ id: "worker", tone: "positive", label: "Worker online" }] as const;
    expect(mostUrgent(fine)).toBeUndefined();
    const trouble = [...fine, { id: "inbox", tone: "danger", label: "Inbox unreachable" }] as const;
    expect(mostUrgent(trouble)?.id).toBe("inbox");
  });

  it("shows a sites chip only while a site is being left alone, and counts them", () => {
    const open = { coolingDownUntil: null, breaker: "closed" } as const;
    const cooling = { coolingDownUntil: "2026-10-07T17:00:00Z", breaker: "closed" } as const;
    const paused = { coolingDownUntil: null, breaker: "open" } as const;
    expect(sitesChip([open])).toBeNull();
    expect(sitesChip([open, cooling])).toEqual({
      id: "sites",
      tone: "attention",
      label: "Cooling down",
      value: "1 site",
    });
    expect(sitesChip([cooling, paused])?.value).toBe("2 sites");
  });

  it("lets a cooling site feed the phone bar mark", () => {
    const chips = [
      { id: "worker", tone: "positive", label: "Worker online" } as const,
      { id: "sites", tone: "attention", label: "Cooling down", value: "1 site" } as const,
    ];
    expect(mostUrgent(chips)?.id).toBe("sites");
  });
});

describe("versionLabel", () => {
  it("puts a v on a release number only", () => {
    expect(versionLabel("0.3.1")).toBe("v0.3.1");
    expect(versionLabel("0.3.1-4-gabc123")).toBe("v0.3.1-4-gabc123");
    expect(versionLabel("71c1711-dirty")).toBe("71c1711-dirty");
    expect(versionLabel("71c1711")).toBe("71c1711");
  });
});
