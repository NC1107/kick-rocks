import type { SettingsView } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { inboxChip, mostUrgent, sendsChip, workerChip } from "./shell-status.js";

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
});
