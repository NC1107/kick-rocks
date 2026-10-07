import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Table, TableBody, TableCell, TableRow } from "./Table.js";

function SelectableTable() {
  const [selected, setSelected] = useState<string | null>("b");
  return (
    <Table label="Rows" role="grid">
      <TableBody>
        {["a", "b", "c"].map((id) => (
          <TableRow key={id} selected={selected === id} onPick={() => setSelected(id)}>
            <TableCell>{id}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

describe("a selectable table", () => {
  it("has one tab stop, on the selected row", () => {
    render(<SelectableTable />);
    const rows = screen.getAllByRole("row");
    expect(rows.map((row) => row.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("moves focus with the arrow keys without changing the selection", async () => {
    const user = userEvent.setup();
    render(<SelectableTable />);
    const rows = screen.getAllByRole("row");
    rows[1]?.focus();
    await user.keyboard("{ArrowDown}");
    expect(rows[2]).toHaveFocus();
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(rows[2]).toHaveAttribute("aria-selected", "false");
  });

  it("selects the focused row with Enter and takes the tab stop with it", async () => {
    const user = userEvent.setup();
    render(<SelectableTable />);
    const rows = screen.getAllByRole("row");
    rows[1]?.focus();
    await user.keyboard("{ArrowUp}{Enter}");
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);
  });

  it("leaves a plain row out of the tab order", () => {
    render(
      <Table label="Plain">
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole("row").getAttribute("tabindex")).toBeNull();
  });
});
