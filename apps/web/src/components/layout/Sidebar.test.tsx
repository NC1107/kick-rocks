import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../test/render.js";
import { SidebarContent } from "./Sidebar.js";

describe("the navigation", () => {
  it("lists only the daily pages and Settings", async () => {
    renderPage(<SidebarContent />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent?.replace(/\d+$/, "").trim());
    expect(labels).toEqual(["Dashboard", "Review", "Requests", "Targets", "Settings"]);
  });

  it("keeps About and the version out of the rail", async () => {
    renderPage(<SidebarContent />);
    await screen.findByRole("navigation", { name: "Main" });
    expect(screen.queryByRole("link", { name: /About/ })).toBeNull();
    expect(screen.queryByText(/^v?\d+\.\d+/)).toBeNull();
  });
});
