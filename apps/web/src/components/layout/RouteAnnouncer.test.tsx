import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { usePageTitle } from "../../lib/use-page-title.js";
import { RouteAnnouncer } from "./RouteAnnouncer.js";

function Page({ title }: { title: string }) {
  usePageTitle(title);
  return <h1>{title}</h1>;
}

function Shell() {
  return (
    <>
      <RouteAnnouncer />
      <Outlet />
    </>
  );
}

describe("the route announcer", () => {
  it("says nothing on first load and speaks the new title after a navigation", async () => {
    const router = createMemoryRouter([
      {
        element: <Shell />,
        children: [
          { path: "/", element: <Page title="Dashboard" /> },
          { path: "/targets", element: <Page title="Targets" /> },
        ],
      },
    ]);
    const { container } = render(<RouterProvider router={router} />);
    const region = container.querySelector("[aria-live=polite]");
    expect(region).toBeEmptyDOMElement();

    await act(async () => {
      await router.navigate("/targets");
    });
    expect(
      await screen.findByText("Targets - Kick Rocks", { selector: "[aria-live]" }),
    ).toBeVisible();
  });
});
