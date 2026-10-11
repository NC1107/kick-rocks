import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataList } from "./DataList.js";

interface Row {
  id: string;
  name: string;
}

const ROWS: Row[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Bravo" },
];

function stubScreen(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide && query === "(min-width: 1024px)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function Harness({ pager }: { pager?: { total: number } }) {
  const [picked, setPicked] = useState<readonly string[]>([]);
  return (
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={
            <DataList
              label="Things"
              items={ROWS}
              getKey={(row) => row.id}
              identityHeader="Name"
              identity={(row) => ({ title: row.name, to: `/things/${row.id}` })}
              columns={[{ id: "id", header: "Id", cell: (row) => row.id }]}
              tags={(row) => <span>{row.id}</span>}
              count="2 things"
              selection={{
                idPrefix: "pick",
                isChecked: (row) => picked.includes(row.id),
                onToggle: (row, on) =>
                  setPicked((current) =>
                    on ? [...current, row.id] : current.filter((id) => id !== row.id),
                  ),
                label: (row) => `Select ${row.name}`,
              }}
              {...(pager
                ? {
                    pager: {
                      page: 1,
                      pageSize: 50,
                      total: pager.total,
                      onPageChange: () => {},
                    },
                  }
                : {})}
            />
          }
        />
        <Route path="/things/:id" element={<p>Opened a thing</p>} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("the shared list", () => {
  it("is a table on a wide screen", () => {
    stubScreen(true);
    render(<Harness />);
    expect(within(screen.getByRole("region", { name: "Things" })).getByRole("table")).toBeVisible();
  });

  it("is stacked rows on a phone, with no table to run off the edge", () => {
    stubScreen(false);
    render(<Harness />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Things" })).getAllByRole("listitem"),
    ).toHaveLength(2);
  });

  it("toggles a phone row from its box and never opens the row", async () => {
    stubScreen(false);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).toBeChecked();
    expect(screen.queryByText("Opened a thing")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).not.toBeChecked();
  });

  it("gives a phone row's box a 44px target that sits above the row's link", () => {
    stubScreen(false);
    render(<Harness />);
    const target = screen.getByRole("checkbox", { name: "Select Alpha" }).closest("label");
    expect(target).toHaveClass("min-h-11", "min-w-11", "relative", "z-10");
  });

  it("opens a phone row from its name", async () => {
    stubScreen(false);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("link", { name: "Alpha" }));
    expect(screen.getByText("Opened a thing")).toBeVisible();
  });

  it("carries a compact count and no pager when everything fits on one page", () => {
    stubScreen(false);
    render(<Harness pager={{ total: 2 }} />);
    expect(screen.getByText("2 things")).toBeVisible();
    expect(screen.queryByRole("navigation", { name: /pagination/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/1-2 of 2/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next|previous/i })).not.toBeInTheDocument();
  });

  it("shows the pager once there is more than one page", () => {
    stubScreen(true);
    render(<Harness pager={{ total: 120 }} />);
    expect(screen.getByText(/1-50 of 120/)).toBeVisible();
  });
});
