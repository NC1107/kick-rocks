import type { WaitingTask } from "@kickrocks/shared";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
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
    <MemoryRouter>
      <QueueList
        entries={[]}
        kinds={["agents"]}
        empty="Nothing is waiting for an agent."
        waiting={waiting}
        waitingTotal={waitingTotal}
        selectedKey={null}
        onSelect={() => {}}
      />
    </MemoryRouter>,
  );

describe("the waiting group in the queue list", () => {
  it("is absent when no task is waiting on a site", () => {
    list([]);
    expect(screen.queryByRole("heading", { name: /Waiting/ })).toBeNull();
  });

  it("lists one row per target with its reason and one time, under a counted label", () => {
    list([item(1), item(2, { waiting: { ...item(2).waiting, reason: "site_daily_cap" } })]);
    const heading = screen.getByRole("heading", { name: "Waiting · 2" });
    const rows = within(heading.closest("section") as HTMLElement);
    expect(rows.getByText(/cooling down/)).toBeVisible();
    expect(rows.getByText(/has had its visits for today/)).toBeVisible();
    expect(rows.queryByText("in 5h")).toBeNull();
    expect(rows.getByRole("link", { name: "Broker 1" })).toHaveAttribute(
      "href",
      "/targets/target_1",
    );
    expect(rows.queryByRole("button")).toBeNull();
  });

  it("counts every waiting task even when the list shows only some", () => {
    list([item(1), item(2)], 140);
    expect(screen.getByRole("heading", { name: "Waiting · 140" })).toBeVisible();
    expect(screen.getByText("+138 more")).toBeVisible();
  });
});

describe("a row in the list", () => {
  const entry = {
    key: "failed:tsk_1",
    kind: "failed",
    item: {
      task: {
        id: "tsk_1",
        targetName: "Broker",
        requestId: "req_1",
        lastError: "The search page did not load",
        failureKind: "site",
      },
      requestReference: "KR-ABC123",
    },
  } as never;

  const renderEntry = () =>
    render(
      <MemoryRouter>
        <QueueList
          entries={[entry]}
          kinds={["failed"]}
          empty="No problems."
          selectedKey={null}
          onSelect={() => {}}
        />
      </MemoryRouter>,
    );

  it("links the request beside the select button, never inside it", () => {
    renderEntry();
    const link = screen.getByRole("link", { name: "KR-ABC123" });
    expect(link).toHaveAttribute("href", "/requests/req_1");
    expect(link.closest("button")).toBeNull();
  });

  it("says so when the page has no rows", () => {
    render(
      <MemoryRouter>
        <QueueList
          entries={[]}
          kinds={["mail"]}
          empty="No unsorted mail."
          selectedKey={null}
          onSelect={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("No unsorted mail.")).toBeVisible();
  });
});
