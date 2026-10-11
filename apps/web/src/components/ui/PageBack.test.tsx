import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { PageBack } from "./PageBack.js";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAt(entries: string[]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Where />
      <Routes>
        <Route path="*" element={<PageBack to="/targets" label="Targets" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("the back control", () => {
  it("returns to the screen the person came from inside the app", async () => {
    const user = userEvent.setup();
    renderAt(["/requests/req_1", "/targets/harbor"]);
    await user.click(screen.getByRole("link", { name: "Targets" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/requests/req_1");
  });

  it("goes to the logical parent when the page was the first screen of the visit", async () => {
    const user = userEvent.setup();
    renderAt(["/targets/harbor"]);
    await user.click(screen.getByRole("link", { name: "Targets" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/targets");
  });

  it("keeps the parent as the link target for new tabs and copied links", () => {
    renderAt(["/requests/req_1", "/targets/harbor"]);
    expect(screen.getByRole("link", { name: "Targets" })).toHaveAttribute("href", "/targets");
  });
});
