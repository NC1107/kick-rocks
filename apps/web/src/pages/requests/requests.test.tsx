import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { hasRequestFilters, readRequestFilters, toRequestQuery } from "./filters.js";
import { Component as RequestsPage } from "./index.js";

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
  const region = await screen.findByRole("region", { name: "Requests" });
  await waitFor(() => expect(within(region).queryByText("Loading")).not.toBeInTheDocument());
  return within(region).getAllByRole("row").slice(1);
}

const open = (route = "/requests", mock?: MockApp) =>
  renderPage(<RequestsPage />, { path: "/requests", route, ...(mock ? { mock } : {}) });

describe("the requests page", () => {
  it("lists the current profile's requests with status, reference, and channel", async () => {
    open();
    const list = await rows();
    expect(list.length).toBe(25);
    const first = within(list[0] as HTMLElement);
    expect(first.getByText(/^KR-/)).toBeVisible();
    expect(first.getAllByText(/Email|Web form/).length).toBeGreaterThan(0);
  });

  it("filters by status from the address bar", async () => {
    open("/requests?status=needs_verification");
    await waitFor(async () => expect((await rows()).length).toBe(2));
    expect(screen.getByLabelText("Status")).toHaveValue("needs_verification");
    expect(screen.getAllByText("Needs verification").length).toBeGreaterThan(0);
  });

  it("filters to one target and says which", async () => {
    open("/requests?targetId=audiencegrid");
    expect(await screen.findByText(/Showing requests to/)).toBeVisible();
    await waitFor(async () => expect((await rows()).length).toBe(1));
    expect(await screen.findByText("AudienceGrid", { selector: "span" })).toBeVisible();
  });

  it("searches by reference", async () => {
    const { user, mock } = open();
    await rows();
    const reference = mock.store.requests[3]?.reference ?? "";
    await user.type(screen.getByRole("searchbox", { name: "Search" }), reference);
    await waitFor(async () => expect((await rows()).length).toBe(1));
  });

  it("links each row to its request", async () => {
    open();
    const list = await rows();
    const link = within(list[0] as HTMLElement).getByRole("link");
    expect(link.getAttribute("href")).toMatch(/^\/requests\/req_/);
  });

  it("shows a way forward when there are no requests at all", async () => {
    const mock = failing(/never/);
    mock.store.requests.length = 0;
    open("/requests", mock);
    expect(await screen.findByText("No requests yet")).toBeVisible();
    expect(screen.getAllByRole("link", { name: /campaign/i }).length).toBeGreaterThan(0);
  });

  it("shows an empty state with a way out when a filter matches nothing", async () => {
    const { user } = open("/requests?q=nothing-matches-this");
    expect(await screen.findByText("No requests match")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Clear filters" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect((await rows()).length).toBeGreaterThan(1);
  });

  it("says when the list cannot load and offers another try", async () => {
    open("/requests", failing(/\/requests\?/));
    expect(await screen.findByText("Could not load requests")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

describe("request filters", () => {
  it("ignores a status or channel that is not real", () => {
    const filters = readRequestFilters(new URLSearchParams("status=bogus&channel=fax&page=0"));
    expect(filters).toMatchObject({ status: "", channel: "", page: 1 });
    expect(hasRequestFilters(filters)).toBe(false);
  });

  it("sends the status as a list, which is how the route reads it", () => {
    expect(
      toRequestQuery(readRequestFilters(new URLSearchParams("status=sent&channel=form"))),
    ).toEqual({
      page: 1,
      pageSize: 25,
      status: ["sent"],
      channel: "form",
    });
  });
});
