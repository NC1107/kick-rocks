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

describe("the reason on a queue entry", () => {
  const entry = {
    key: "blocked:tsk_1",
    kind: "blocked",
    item: {
      task: {
        id: "tsk_1",
        targetName: "Broker",
        requestId: "req_1",
        blockedReason: "id_upload",
        blockedDetail:
          "The removal form asks for a photo of a government ID before it will continue",
      },
      requestReference: "KR-ABC123",
    },
  } as never;

  const renderEntry = () =>
    render(
      <MemoryRouter>
        <QueueList
          entries={[entry]}
          waiting={[]}
          waitingTotal={0}
          selectedKey={null}
          onSelect={() => {}}
        />
      </MemoryRouter>,
    );

  it("keeps a blocked reason to its short label and leaves the full text to the detail", () => {
    renderEntry();
    expect(screen.getByText("ID upload")).toBeVisible();
    expect(screen.queryByText(/photo of a government ID/)).toBeNull();
  });

  it("links the request beside the select button, never inside it", () => {
    renderEntry();
    const link = screen.getByRole("link", { name: "KR-ABC123" });
    expect(link).toHaveAttribute("href", "/requests/req_1");
    expect(link.closest("button")).toBeNull();
  });
});
