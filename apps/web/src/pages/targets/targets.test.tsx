import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { readFilters, toQuery } from "./filters.js";
import { Component as TargetsPage } from "./index.js";

/** Routes matching `pattern` answer 403, a client error, so the query client does not retry and wait. */
function failing(pattern: RegExp): MockApp {
  const mock = createMockApp();
  const handle = mock.handle.bind(mock);
  mock.handle = async (request) =>
    pattern.test(request.url)
      ? {
          status: 403,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "forbidden", message: "Blocked for the test." }),
        }
      : handle(request);
  return mock;
}

async function rows() {
  const table = await screen.findByRole("region", { name: "Targets" });
  await waitFor(() => expect(within(table).queryByText("Loading")).not.toBeInTheDocument());
  return within(table).getAllByRole("row").slice(1);
}

describe("the targets page", () => {
  it("lists targets with their priority, contact method, and what needs a person", async () => {
    renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    const list = await rows();
    expect(list.length).toBe(50);
    expect(within(list[0] as HTMLElement).getByRole("link", { name: "ClearCheck" })).toBeVisible();
    expect(within(list[0] as HTMLElement).getByText("ID upload")).toBeVisible();
    expect(screen.getByText(/1-50 of 61/)).toBeVisible();
    expect(screen.getByText("61 targets")).toBeVisible();
  });

  it("tags only the requirements that need the person", async () => {
    renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    const list = await rows();
    const findRecord = list.find((row) => within(row).queryByRole("link", { name: "FindRecord" }));
    expect(within(findRecord as HTMLElement).getByText("CAPTCHA")).toBeVisible();
    expect(within(findRecord as HTMLElement).queryByText("Record URL")).not.toBeInTheDocument();
    expect(screen.queryByText("None")).not.toBeInTheDocument();
  });

  it("shows scan and removal as two status marks", async () => {
    renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    const list = await rows();
    const findRecord = list.find((row) => within(row).queryByRole("link", { name: "FindRecord" }));
    const cells = within(findRecord as HTMLElement).getAllByRole("cell");
    expect(cells.at(-2)).toHaveTextContent("Healthy");
    expect(cells.at(-1)).toHaveTextContent("Broken");
  });

  it("goes to the second page with the rest of the targets", async () => {
    const { user } = renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    await rows();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(screen.getByText(/51-61 of 61/)).toBeVisible());
    expect((await rows()).length).toBe(11);
  });

  it("narrows the list as a person searches", async () => {
    const { user } = renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    await rows();
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "peopletrace");
    await waitFor(async () => expect((await rows()).length).toBe(1));
    expect(screen.getByRole("link", { name: "PeopleTrace" })).toBeVisible();
  });

  it("filters by type from the facets and starts from the address bar", async () => {
    renderPage(<TargetsPage />, { path: "/targets", route: "/targets?kind=company" });
    await waitFor(() => expect(screen.getByText(/1-32 of 32/)).toBeVisible());
    expect(screen.getByLabelText("Type")).toHaveValue("company");
  });

  it("shows an empty state with a way out when nothing matches", async () => {
    const { user } = renderPage(<TargetsPage />, {
      path: "/targets",
      route: "/targets?q=nothing-called-this",
    });
    expect(await screen.findByText("No targets match these filters.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect((await rows()).length).toBeGreaterThan(1);
  });

  it("carries the selected targets to the campaign builder", async () => {
    const { user } = renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    await rows();
    await user.click(screen.getByRole("checkbox", { name: "Select ClearCheck" }));
    await user.click(screen.getByRole("checkbox", { name: "Select FindRecord" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 selected");
    const link = screen.getByRole("link", { name: "Ask these to remove my data" });
    expect(link).toHaveAttribute("href", "/campaigns/new?targets=clearcheck,findrecord");
  });

  it("says when the list cannot load and offers another try", async () => {
    renderPage(<TargetsPage />, {
      path: "/targets",
      route: "/targets",
      mock: failing(/\/api\/targets\?/),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load targets");
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

describe("target filters", () => {
  it("drops values that are not real options", () => {
    const filters = readFilters(new URLSearchParams("kind=bogus&category=marketing&page=-2"));
    expect(filters.kind).toBe("");
    expect(filters.category).toBe("marketing");
    expect(filters.page).toBe(1);
  });

  it("leaves empty filters out of the query", () => {
    expect(toQuery(readFilters(new URLSearchParams("q=%20spo%20&priority=high")))).toEqual({
      page: 1,
      pageSize: 50,
      q: "spo",
      priority: "high",
    });
  });
});
