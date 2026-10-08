import type { WaitingTask } from "@kickrocks/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WaitingNotice } from "./WaitingNotice.js";

const item = (overrides: Partial<WaitingTask> = {}): WaitingTask => ({
  taskId: "tsk_1",
  kind: "scan",
  targetId: "peopletrace",
  targetName: "PeopleTrace",
  waiting: {
    reason: "site_cooldown",
    domain: "peopletrace.example",
    until: new Date(Date.now() + 5 * 3_600_000).toISOString(),
  },
  ...overrides,
});

describe("the waiting notice", () => {
  it("says nothing when no task is waiting on a site", () => {
    const { container } = render(<WaitingNotice items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("explains that a task is waiting for a site rather than failing, and why", () => {
    render(
      <WaitingNotice
        items={[
          item(),
          item({
            taskId: "tsk_2",
            kind: "form",
            targetName: "NameLookup",
            waiting: {
              reason: "site_daily_cap",
              domain: "namelookup.example",
              until: new Date(Date.now() + 3_600_000).toISOString(),
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("2 tasks waiting on a site, not failing")).toBeVisible();
    expect(screen.getByText(/Scan for PeopleTrace/).closest("li")).toHaveTextContent(
      "that site asked to be left alone for a while",
    );
    expect(screen.getByText(/Removal for NameLookup/).closest("li")).toHaveTextContent(
      "that site has had its visits for the day",
    );
  });
});
