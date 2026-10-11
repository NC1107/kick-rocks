import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { appRoutes } from "./router.js";

function Where() {
  return <p>{useLocation().pathname}</p>;
}

function visit(path: string) {
  const redirects = appRoutes.filter((route) => route.element);
  const router = createMemoryRouter([...redirects, { path: "/settings/*", element: <Where /> }], {
    initialEntries: [path],
  });
  render(<RouterProvider router={router} />);
}

describe("the old Profiles and About URLs", () => {
  it.each([
    ["/profiles", "/settings/profiles"],
    ["/about", "/settings/about"],
  ])("send %s to %s", (from, to) => {
    visit(from);
    expect(screen.getByText(to)).toBeInTheDocument();
  });
});
