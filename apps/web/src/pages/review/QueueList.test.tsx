import type { WaitingTask } from "@kickrocks/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QueueList } from "./QueueList.js";

const item = (n: number, overrides: Partial<WaitingTask> = {}): WaitingTask => ({
  taskId: `tsk_${n}`,
  kind: "scan",
  targetId: `target_${n}`,
  targetName: `Broker ${n}`,
  waiting: {
    reason: "site_cooldown",
    domain: `broker${n}.example`,
    until: new Date(Date.now() + 5 * 3_600_000).toISOString(),
  },
  ...overrides,
});

const list = (waiting: WaitingTask[], waitingTotal = waiting.length) =>
  render(
    <QueueList
      entries={[]}
      waiting={waiting}
      waitingTotal={waitingTotal}
      selectedKey={null}
      onSelect={() => {}}
    />,
  );

describe("the waiting group in the queue list", () => {
  it("is absent when no task is waiting on a site", () => {
    list([]);
    expect(screen.queryByRole("heading", { name: /Waiting/ })).toBeNull();
  });

  it("lists one row per target with its reason and a short time, under a counted label", () => {
    list([item(1), item(2, { waiting: { ...item(2).waiting, reason: "site_daily_cap" } })]);
    const heading = screen.getByRole("heading", { name: "Waiting · 2" });
    const rows = within(heading.closest("section") as HTMLElement);
    expect(rows.getByText("Broker 1")).toBeVisible();
    expect(rows.getByText(/asked for a break/)).toBeVisible();
    expect(rows.getByText(/has had its visits for today/)).toBeVisible();
    expect(rows.getAllByText("in 5h")).toHaveLength(2);
    expect(rows.queryByRole("button")).toBeNull();
  });

  it("counts every waiting task even when the list shows only some", () => {
    list([item(1), item(2)], 140);
    expect(screen.getByRole("heading", { name: "Waiting · 140" })).toBeVisible();
    expect(screen.getByText("+138 more")).toBeVisible();
  });
});

describe("the reason on a queue entry", () => {
  it("wraps so a long sentence is never cut off with an ellipsis", () => {
    const reason = "The removal form asks for a photo of a government ID before it will continue";
    render(
      <QueueList
        entries={[
          {
            key: "blocked:tsk_1",
            kind: "blocked",
            item: { task: { id: "tsk_1", targetName: "Broker", blockedDetail: reason } },
          } as never,
        ]}
        waiting={[]}
        waitingTotal={0}
        selectedKey={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(reason, { exact: false }).className).not.toContain("truncate");
  });
});
