import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../test/render.js";
import { PublicLayout } from "./PublicLayout.js";

describe("the public layout", () => {
  it("keeps the theme toggle inside a landmark, not loose on the page", () => {
    renderPage(<PublicLayout />, { withProfile: false });
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("group", { name: "Theme" })).toBeInTheDocument();
  });
});
