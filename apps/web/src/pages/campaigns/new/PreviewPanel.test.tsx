import type { TargetOutcome } from "@kickrocks/shared";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AdvisoryList } from "./PreviewPanel.js";

const item = (targetId: string, detail: string | null): TargetOutcome => ({
  targetId,
  targetName: `Broker ${targetId}`,
  outcome: "request_created",
  requestId: null,
  scanId: null,
  reason: null,
  detail,
});

describe("AdvisoryList", () => {
  it("shows the note of each target that goes ahead with one", () => {
    render(
      <MemoryRouter>
        <AdvisoryList items={[item("a", "DROP can delete what it holds."), item("b", null)]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Worth knowing/)).toBeVisible();
    expect(screen.getByText("Broker a")).toBeVisible();
    expect(screen.getByText("DROP can delete what it holds.")).toBeVisible();
    expect(screen.queryByText("Broker b")).toBeNull();
  });

  it("renders nothing when no target has a note", () => {
    const { container } = render(
      <MemoryRouter>
        <AdvisoryList items={[item("a", null)]} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
