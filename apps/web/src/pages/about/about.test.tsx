import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { instrument } from "../profiles/test-support.js";
import { Component as AboutPage } from "./index.js";

describe("the about page", () => {
  it("shows the version, the list sizes, and the license of the code", async () => {
    renderPage(<AboutPage />, { withProfile: false });
    expect(await screen.findByText("0.1.0-mock")).toBeInTheDocument();
    expect(screen.getByText(/29 brokers, built/)).toBeInTheDocument();
    expect(screen.getByText("32 companies")).toBeInTheDocument();
    const license = screen.getByRole("link", { name: /PolyForm Noncommercial 1\.0\.0/ });
    expect(license).toHaveAttribute(
      "href",
      "https://polyformproject.org/licenses/noncommercial/1.0.0/",
    );
    expect(screen.getByText(/Copyright NC1107/)).toBeInTheDocument();
  });

  it("lists every data source with its license and how many entries use it", async () => {
    renderPage(<AboutPage />, { withProfile: false });
    const sources = (await screen.findByRole("heading", { name: "Data sources" })).closest(
      "section",
    ) as HTMLElement;
    const rows = await within(sources).findAllByRole("listitem");
    expect(rows).toHaveLength(6);

    const badbool = rows.find((row) => within(row).queryByText("Big Ass Data Broker Opt-Out List"));
    expect(badbool).toBeDefined();
    expect(within(badbool as HTMLElement).getByText("CC BY-NC-SA 4.0")).toBeInTheDocument();
    expect(within(badbool as HTMLElement).getByText(/By Yael Grauer/)).toBeInTheDocument();
    expect(within(badbool as HTMLElement).getByText(/Used by \d+ entries/)).toBeInTheDocument();

    const eraser = rows.find((row) => within(row).queryByText("Eraser broker list"));
    expect(within(eraser as HTMLElement).getByText("MIT")).toBeInTheDocument();
  });

  it("opens source links in a new tab, safely", async () => {
    renderPage(<AboutPage />, { withProfile: false });
    const link = await screen.findByRole("link", { name: /Eraser broker list/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("carries the BADBOOL attribution, license, and the ShareAlike notice", async () => {
    renderPage(<AboutPage />, { withProfile: false });
    const card = (await screen.findByRole("heading", { name: "Attribution" })).closest(
      "section",
    ) as HTMLElement;
    expect(within(card).getByText(/Yael Grauer/)).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: /Big Ass Data Broker Opt-Out List/ }),
    ).toHaveAttribute("href", "https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List");
    expect(within(card).getByRole("link", { name: /CC BY-NC-SA 4\.0/ })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    );
    expect(card).toHaveTextContent(/converted those entries/);
    expect(card).toHaveTextContent(/same license/);
  });

  it("says the broker list is not built when it is not", async () => {
    const mock = createMockApp();
    const handle = mock.handle.bind(mock);
    mock.handle = async (request) => {
      const response = await handle(request);
      if (request.url === "/api/status" && typeof response.body === "string") {
        const status = JSON.parse(response.body);
        status.brokers = { available: false, total: 0 };
        return { ...response, body: JSON.stringify(status) };
      }
      return response;
    };
    renderPage(<AboutPage />, { mock, withProfile: false });
    expect(await screen.findByText(/Not built yet\. Run pnpm data:build/)).toBeInTheDocument();
  });

  it("shows skeletons while loading", () => {
    renderPage(<AboutPage />, { withProfile: false });
    expect(document.querySelectorAll("[aria-hidden=true].animate-pulse").length).toBeGreaterThan(0);
  });

  it("keeps the rest of the page when the sources cannot load, and retries", async () => {
    const mock = createMockApp();
    instrument(mock, {
      match: "GET /api/settings/data-sources",
      status: 403,
      body: { error: "forbidden", message: "That request was blocked." },
    });
    const { user } = renderPage(<AboutPage />, { mock, withProfile: false });
    expect(await screen.findByText("Could not load the data sources")).toBeInTheDocument();
    expect(screen.getByText("That request was blocked.")).toBeInTheDocument();
    expect(await screen.findByText("0.1.0-mock")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Attribution" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
  });

  it("shows what loaded when the server details cannot", async () => {
    const mock = createMockApp();
    instrument(mock, {
      match: "GET /api/status",
      status: 403,
      body: { error: "forbidden", message: "That request was blocked." },
    });
    renderPage(<AboutPage />, { mock, withProfile: false });
    expect(await screen.findByText("Could not load this instance's details")).toBeInTheDocument();
    expect(screen.getByText("0.1.0-mock")).toBeInTheDocument();
    expect(screen.queryByText("Company list")).toBeNull();
  });
});
