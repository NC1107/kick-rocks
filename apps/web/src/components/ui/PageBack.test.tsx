import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { PageBack } from "./PageBack.js";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

/** The browser history keeps the depth a real router reads; a memory router has no such state. */
function atHistoryDepth(idx: number) {
  window.history.replaceState({ usr: null, key: "test", idx }, "");
}

function renderAt(entries: string[], depth: number) {
  atHistoryDepth(depth);
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Where />
      <Routes>
        <Route path="*" element={<PageBack to="/targets" label="Targets" />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => window.history.replaceState(null, ""));

describe("the back control", () => {
  it("returns to the screen the person came from inside the app", async () => {
    const user = userEvent.setup();
    renderAt(["/requests/req_1", "/targets/harbor"], 1);
    await user.click(screen.getByRole("link", { name: "Back" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/requests/req_1");
  });

  it("goes to the logical parent when the page was the first screen of the visit", async () => {
    const user = userEvent.setup();
    renderAt(["/targets/harbor"], 0);
    await user.click(screen.getByRole("link", { name: "Targets" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/targets");
  });

  it("goes to the parent when the first screen was only reached through a redirect", async () => {
    const user = userEvent.setup();
    atHistoryDepth(0);
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Where />
        <Routes>
          <Route path="/login" element={<Navigate to="/targets/harbor" replace />} />
          <Route path="*" element={<PageBack to="/targets" label="Targets" />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("link", { name: "Targets" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/targets");
  });

  it("names the control for what it does and keeps the parent as the link target", () => {
    renderAt(["/requests/req_1", "/targets/harbor"], 1);
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/targets");
    expect(screen.queryByRole("link", { name: "Targets" })).not.toBeInTheDocument();
  });
});
