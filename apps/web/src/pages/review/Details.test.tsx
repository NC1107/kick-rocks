import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Details } from "./Details.js";

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ label: `Row ${index}`, value: `value ${index}` }));

describe("Details", () => {
  it("opens by itself when there are only a few rows", () => {
    render(<Details rows={rows(3)} />);
    expect(screen.getByText("Details").closest("details")).toHaveAttribute("open");
  });

  it("stays closed when there are enough rows to push the action out of view", () => {
    render(<Details rows={rows(4)} />);
    expect(screen.getByText("Details").closest("details")).not.toHaveAttribute("open");
  });

  it("stays closed when there is nothing to show", () => {
    render(<Details rows={[]} />);
    expect(screen.getByText("Details").closest("details")).not.toHaveAttribute("open");
  });
});
