import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
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

  it("waits for a page that loads data and speaks its real title only", async () => {
    function Slow() {
      const [data, setData] = useState(false);
      useEffect(() => {
        const timer = setTimeout(() => setData(true), 400);
        return () => clearTimeout(timer);
      }, []);
      usePageTitle(data ? "Harbor Consumer Data" : "Request");
      return <main id="main" aria-busy={data ? undefined : "true"} />;
    }
    const router = createMemoryRouter([
      {
        element: <Shell />,
        children: [
          { path: "/", element: <Page title="Dashboard" /> },
          { path: "/requests/1", element: <Slow /> },
        ],
      },
    ]);
    const { container } = render(<RouterProvider router={router} />);
    const region = container.querySelector("[aria-live=polite]");
    const spoken: string[] = [];
    new MutationObserver(() => {
      if (region?.textContent) spoken.push(region.textContent);
    }).observe(region as Node, { childList: true, characterData: true, subtree: true });

    await act(async () => {
      await router.navigate("/requests/1");
    });
    await waitFor(() => expect(region).toHaveTextContent("Harbor Consumer Data - Kick Rocks"), {
      timeout: 3000,
    });
    expect(spoken).toEqual(["Harbor Consumer Data - Kick Rocks"]);
  });
});
