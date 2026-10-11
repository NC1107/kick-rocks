import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    expect(list.length).toBe(34);
    const first = within(list[0] as HTMLElement);
    expect(first.getByText(/^KR-/)).toBeVisible();
    expect(first.getAllByText(/Email|Web form/).length).toBeGreaterThan(0);
  });

  it("shows a due date under the status only for a request still waiting", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    open();
    const region = await screen.findByRole("list", { name: "Requests" });
    await waitFor(() => expect(within(region).queryByText("Loading")).not.toBeInTheDocument());
    const list = within(region).getAllByRole("listitem");
    const finished = list.filter((row) => within(row).queryByText("Confirmed"));
    expect(finished.length).toBeGreaterThan(0);
    for (const row of finished) expect(row.textContent).not.toMatch(/due /);
    const waiting = list.filter((row) => within(row).queryByText("Awaiting reply"));
    expect(waiting.some((row) => /due /.test(row.textContent ?? ""))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("prints what each request asked for as mono tokens, and a dash for a missing date", async () => {
    open();
    const list = await rows();
    const text = list.map((row) => row.textContent ?? "").join("\n");
    expect(text).toMatch(/opt-out/);
    expect(text).toMatch(/delete/);
    expect(text).not.toContain("None");
    const drafts = list.filter((row) => within(row).queryByText("Draft"));
    expect(drafts.length).toBeGreaterThan(0);
    for (const row of drafts) expect(within(row).getAllByText("-")).toHaveLength(2);
  });

  it("counts the requests in the toolbar", async () => {
    open();
    await rows();
    expect(await screen.findByText("34 requests")).toBeVisible();
  });

  it("filters by status from the address bar", async () => {
    open("/requests?status=needs_verification");
    await waitFor(async () => expect((await rows()).length).toBe(2));
    expect(screen.getByRole("list", { name: "Active filters" })).toHaveTextContent(
      "Status: Needs verification",
    );
    for (const row of await rows())
      expect(within(row).getByText("Needs verification")).toBeVisible();
  });

  it("filters to one target and says which", async () => {
    open("/requests?targetId=audiencegrid");
    await waitFor(async () => expect((await rows()).length).toBe(1));
    expect(await screen.findByText("Target: AudienceGrid")).toBeVisible();
    expect(screen.getByRole("button", { name: "Filters, 1 active" })).toBeVisible();
  });

  it("filters from the popup and drops the filter when its tag is removed", async () => {
    const { user } = open();
    await rows();
    expect(screen.queryByRole("list", { name: "Active filters" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.selectOptions(screen.getByLabelText("Status"), "needs_verification");
    await waitFor(async () => expect((await rows()).length).toBe(2));
    await user.click(screen.getByRole("button", { name: "Remove Status: Needs verification" }));
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(2));
    expect(screen.queryByRole("list", { name: "Active filters" })).not.toBeInTheDocument();
  });

  it("removes the target filter from its tag", async () => {
    const { user } = open("/requests?targetId=audiencegrid");
    await waitFor(async () => expect((await rows()).length).toBe(1));
    await user.click(await screen.findByRole("button", { name: "Remove Target: AudienceGrid" }));
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(1));
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
    expect(await screen.findByText("No requests yet.")).toBeVisible();
    expect(screen.getAllByRole("link", { name: /campaign/i }).length).toBeGreaterThan(0);
  });

  it("shows an empty state with a way out when a filter matches nothing", async () => {
    const { user } = open("/requests?q=nothing-matches-this");
    expect(await screen.findByText("No requests match these filters.")).toBeVisible();
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

describe("the profile scope", () => {
  it("names the current profile and lists only its requests", async () => {
    open();
    await rows();
    expect(screen.getByRole("button", { name: "Profile: Jordan Example" })).toBeVisible();
  });

  it("lists every profile's requests, with a Profile column, when asked for all profiles", async () => {
    const { user, mock } = open();
    const own = (await rows()).length;
    await user.click(screen.getByRole("button", { name: "Profile: Jordan Example" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "All profiles" }));
    await waitFor(async () => expect((await rows()).length).toBe(mock.store.requests.length));
    expect(mock.store.requests.length).toBeGreaterThan(own);
    expect(screen.getByRole("columnheader", { name: "Profile" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Riley Sample" }).length).toBeGreaterThan(0);
  });

  it("switches to another profile without touching the current one", async () => {
    const { user, mock } = open();
    await rows();
    await user.click(screen.getByRole("button", { name: "Profile: Jordan Example" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Riley Sample" }));
    const riley = mock.store.profiles[1];
    await waitFor(async () =>
      expect((await rows()).length).toBe(
        mock.store.requests.filter((request) => request.profileId === riley?.id).length,
      ),
    );
    expect(screen.getByRole("button", { name: "Profile: Riley Sample" })).toBeVisible();
  });

  it("opens with all profiles from the address", async () => {
    const { mock } = open("/requests?profileId=all");
    await waitFor(async () => expect((await rows()).length).toBe(mock.store.requests.length));
  });
});

describe("filtering by campaign", () => {
  it("lists the requests of one campaign and says so in a removable tag", async () => {
    const mock = createMockApp();
    const [first, second] = mock.store.requests;
    if (!(first && second)) throw new Error("fixture");
    first.campaignId = "cmp_x";
    second.campaignId = "cmp_x";
    first.profileId = second.profileId = mock.store.profiles[0]?.id ?? "";
    const { user } = open("/requests?campaignId=cmp_x", mock);
    await waitFor(async () => expect((await rows()).length).toBe(2));
    await user.click(await screen.findByRole("button", { name: "Remove From one campaign" }));
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(2));
  });
});

describe("request filters", () => {
  it("ignores a status or channel that is not real", () => {
    const filters = readRequestFilters(new URLSearchParams("status=bogus&channel=fax&page=0"));
    expect(filters).toMatchObject({ status: "", channel: "", page: 1 });
    expect(hasRequestFilters(filters)).toBe(false);
  });

  it("reads the campaign and the profile scope", () => {
    const filters = readRequestFilters(new URLSearchParams("campaignId=cmp_1&profileId=all"));
    expect(filters).toMatchObject({ campaignId: "cmp_1", profileId: "all" });
    expect(hasRequestFilters(filters)).toBe(true);
    expect(toRequestQuery(filters)).toMatchObject({ campaignId: "cmp_1" });
  });

  it("sends the status as a list, which is how the route reads it", () => {
    expect(
      toRequestQuery(readRequestFilters(new URLSearchParams("status=sent&channel=form"))),
    ).toEqual({
      page: 1,
      pageSize: 50,
      status: ["sent"],
      channel: "form",
    });
  });
});
