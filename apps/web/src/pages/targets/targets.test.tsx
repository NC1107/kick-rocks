import type { TargetDetail } from "@kickrocks/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { readFilters, toFilter, toQuery } from "./filters.js";
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

  it("explains the Scan and Removal badges", async () => {
    renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    await rows();
    expect(screen.getByText("What do the Scan and Removal marks mean?")).toBeInTheDocument();
    for (const term of ["Not checked", "Healthy", "Broken", "No recipe"]) {
      expect(screen.getAllByText(term).length).toBeGreaterThan(0);
    }
  });

  it("narrows the list as a person searches", async () => {
    const { user } = renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    await rows();
    const table = screen.getByRole("region", { name: "Targets" });
    // One paste is one change, so the work does not grow with the CPU a typed character costs on a
    // loaded runner; the debounce still starts only after the last change.
    await user.click(screen.getByRole("searchbox", { name: "Search" }));
    await user.paste("peopletrace");
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(2));
    expect(screen.getByRole("link", { name: "PeopleTrace" })).toBeVisible();
  });

  it("filters by type from the facets and starts from the address bar", async () => {
    renderPage(<TargetsPage />, { path: "/targets", route: "/targets?kind=company" });
    await waitFor(() => expect(screen.getByText(/1-32 of 32/)).toBeVisible());
    expect(screen.getByRole("list", { name: "Active filters" })).toHaveTextContent("Type: Company");
    expect(screen.getByRole("button", { name: "Filters, 1 active" })).toBeVisible();
  });

  it("holds every filter in one popup and applies each as it changes", async () => {
    const { user } = renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    await rows();
    expect(screen.queryByLabelText("Priority")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    for (const name of ["Type", "Category", "Contact", "Needs", "Priority"])
      expect(screen.getByLabelText(name)).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Type"), "company");
    await waitFor(() => expect(screen.getByText(/1-32 of 32/)).toBeVisible());
    expect(screen.getByRole("button", { name: "Filters, 1 active" })).toBeVisible();
  });

  it("filters by difficulty with facet counts in the popup", async () => {
    const { user } = renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    await rows();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    const select = screen.getByLabelText("Difficulty");
    const options = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual([
      "Any difficulty",
      expect.stringMatching(/^Easy \(\d+\)$/),
      expect.stringMatching(/^Medium \(\d+\)$/),
      expect.stringMatching(/^Hard \(\d+\)$/),
    ]);
    await user.selectOptions(select, "easy");
    await waitFor(async () => {
      const list = await rows();
      expect(list.length).toBeGreaterThan(0);
      for (const row of list) expect(within(row).getByText("easy")).toBeVisible();
    });
    expect(screen.getByRole("list", { name: "Active filters" })).toHaveTextContent(
      "Difficulty: Easy",
    );
  });

  it("tags every row with its difficulty", async () => {
    renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    const list = await rows();
    const findRecord = list.find((row) => within(row).queryByRole("link", { name: "FindRecord" }));
    expect(within(findRecord as HTMLElement).getByText("hard")).toBeVisible();
    for (const row of list) {
      expect(within(row).getByText(/^(easy|medium|hard)$/)).toBeVisible();
    }
  });

  it("offers to select everything that matches once the whole page is selected", async () => {
    const { user } = renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    await rows();
    expect(
      screen.queryByRole("button", { name: /Select all .* matching/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select all targets on this page" }));
    expect(screen.getByRole("status")).toHaveTextContent("50 selected");
    await user.click(screen.getByRole("button", { name: "Select all 61 matching" }));
    expect(screen.getByRole("status")).toHaveTextContent("All 61 matching selected");
    expect(screen.getByRole("button", { name: "Clear selection" })).toHaveFocus();
    const link = screen.getByRole("link", { name: "Ask these to remove my data" });
    expect(link).toHaveAttribute("href", `/campaigns/new?filter=${encodeURIComponent("{}")}`);
  });

  it("narrows to the current page, and says so, when one row is unticked after select all", async () => {
    const { user } = renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    const list = await rows();
    await user.click(screen.getByRole("checkbox", { name: "Select all targets on this page" }));
    await user.click(screen.getByRole("button", { name: "Select all 61 matching" }));
    await user.click(within(list[0] as HTMLElement).getByRole("checkbox"));
    expect(screen.getByRole("status")).toHaveTextContent("49 selected");
    // The live region repeats a toast's text for screen readers, so the visible card is found by its region.
    const notifications = screen.getByRole("region", { name: "Notifications" });
    expect(
      await within(notifications).findByText("Selection narrowed to the 49 targets on this page"),
    ).toBeVisible();
  });

  it("carries the filter it is under, not a list of ids", async () => {
    const mock = createMockApp();
    const company = mock.store.targets.find((target) => target.kind === "company");
    for (let index = 0; index < 20; index += 1) {
      mock.store.targets.push({
        ...(company as TargetDetail),
        id: `extra-${index}`,
        name: `Extra ${index}`,
      });
    }
    const { user } = renderPage(<TargetsPage />, {
      path: "/targets",
      route: "/targets?kind=company",
      mock,
    });
    await rows();
    await user.click(screen.getByRole("checkbox", { name: "Select all targets on this page" }));
    await user.click(screen.getByRole("button", { name: "Select all 52 matching" }));
    const link = screen.getByRole("link", { name: "Ask these to remove my data" });
    expect(link).toHaveAttribute(
      "href",
      `/campaigns/new?filter=${encodeURIComponent('{"kind":"company"}')}`,
    );
  });

  it("drops the all-matching selection when the filter changes", async () => {
    const { user } = renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    await rows();
    await user.click(screen.getByRole("checkbox", { name: "Select all targets on this page" }));
    await user.click(screen.getByRole("button", { name: "Select all 61 matching" }));
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.selectOptions(screen.getByLabelText("Type"), "company");
    await waitFor(() => expect(screen.getByText(/1-32 of 32/)).toBeVisible());
    expect(screen.queryByText(/matching selected/)).not.toBeInTheDocument();
  });

  it("scans every matching target by filter after a confirmation", async () => {
    const { user, mock } = renderPage(<TargetsPage />, { path: "/targets", route: "/targets" });
    await rows();
    await user.click(screen.getByRole("checkbox", { name: "Select all targets on this page" }));
    await user.click(screen.getByRole("button", { name: "Select all 61 matching" }));
    const before = mock.store.scans.length;
    await user.click(screen.getByRole("button", { name: "Scan these" }));
    const dialog = await screen.findByRole("dialog");
    const sites = mock.store.targets.filter((target) => target.needsRecord).length;
    expect(
      await within(dialog).findByText(`Scan the ${sites} people-search sites among these 61?`),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Start scans" }));
    await waitFor(() => expect(mock.store.scans.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByText(/matching selected/)).not.toBeInTheDocument());
  });

  it("offers no scan when the filter matches no people-search site", async () => {
    const mock = createMockApp();
    const company = mock.store.targets.find((target) => target.kind === "company");
    for (let index = 0; index < 20; index += 1) {
      mock.store.targets.push({
        ...(company as TargetDetail),
        id: `extra-${index}`,
        name: `Extra ${index}`,
      });
    }
    const { user } = renderPage(<TargetsPage />, {
      path: "/targets",
      route: "/targets?kind=company",
      mock,
    });
    await rows();
    await user.click(screen.getByRole("checkbox", { name: "Select all targets on this page" }));
    await user.click(screen.getByRole("button", { name: "Select all 52 matching" }));
    expect(screen.getByRole("button", { name: "Scan these" })).toBeDisabled();
  });

  it("shows the server's cap message plainly when the selection is too large", async () => {
    const mock = createMockApp();
    const handle = mock.handle.bind(mock);
    const message =
      "That filter matches 6200 targets, and one request takes at most 5000. Narrow the filter and try again.";
    mock.handle = async (request) =>
      /\/scans/.test(request.url) && request.method === "POST"
        ? {
            status: 422,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ error: "selection_too_large", message }),
          }
        : handle(request);
    const { user } = renderPage(<TargetsPage />, { path: "/targets", route: "/targets", mock });
    await rows();
    await user.click(screen.getByRole("checkbox", { name: "Select all targets on this page" }));
    await user.click(screen.getByRole("button", { name: "Select all 61 matching" }));
    await user.click(screen.getByRole("button", { name: "Scan these" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Start scans" }));
    expect(await screen.findByText(message)).toBeVisible();
  });

  it("clears every filter from the popup but keeps the search", async () => {
    const { user } = renderPage(<TargetsPage />, {
      path: "/targets",
      route: "/targets?kind=company&q=a",
    });
    await user.click(await screen.findByRole("button", { name: "Filters, 1 active" }));
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.queryByRole("list", { name: "Active filters" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("a");
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("removes a filter from its tag without opening the popup", async () => {
    const { user } = renderPage(<TargetsPage />, {
      path: "/targets",
      route: "/targets?kind=company",
    });
    await waitFor(() => expect(screen.getByText(/1-32 of 32/)).toBeVisible());
    await user.click(screen.getByRole("button", { name: "Remove Type: Company" }));
    await waitFor(() => expect(screen.getByText(/1-50 of 61/)).toBeVisible());
    expect(screen.getByRole("button", { name: "Filters" })).toBeVisible();
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

describe("the selection filter", () => {
  it("is the list filter without paging", () => {
    expect(toFilter(readFilters(new URLSearchParams("difficulty=easy&q=a&page=3")))).toEqual({
      q: "a",
      difficulty: "easy",
    });
  });

  it("reads difficulty from the address bar and drops a value that is not one", () => {
    expect(readFilters(new URLSearchParams("difficulty=medium")).difficulty).toBe("medium");
    expect(readFilters(new URLSearchParams("difficulty=trivial")).difficulty).toBe("");
  });
});
