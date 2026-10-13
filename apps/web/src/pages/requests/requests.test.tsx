import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../mock/app.js";
import { formatShortDate } from "../../lib/format.js";
import { renderPage } from "../../test/render.js";
import { stubPhone } from "../../test/screen.js";
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

const SECTION_NAMES = ["Needs a look", "In progress", "Done"];

async function rows() {
  await screen.findByLabelText("Filter requests");
  await waitFor(() => expect(screen.queryByLabelText("Loading requests")).not.toBeInTheDocument());
  return SECTION_NAMES.flatMap((name) => {
    const list = screen.queryByRole("list", { name });
    return list ? within(list).getAllByRole("listitem") : [];
  });
}

const open = (route = "/requests", mock?: MockApp) =>
  renderPage(<RequestsPage />, { path: "/requests", route, ...(mock ? { mock } : {}) });

describe("the requests page", () => {
  it("lists the current profile's requests with a plain status and the channel", async () => {
    open();
    const list = await rows();
    expect(list.length).toBe(36);
    const first = within(list[0] as HTMLElement);
    expect(first.getByRole("link")).toBeVisible();
    expect(first.getByText(/email|web form/)).toBeVisible();
  });

  it("keeps the reference code off the list rows", async () => {
    open();
    const list = await rows();
    expect(list.map((row) => row.textContent).join("\n")).not.toMatch(/KR-[A-Z0-9]{6}/);
  });

  it("groups the requests under three labelled sections that add up", async () => {
    open();
    await rows();
    const counts = SECTION_NAMES.map((name) => {
      const heading = screen.getByRole("heading", { name: new RegExp(`^${name} · \\d+$`) });
      return Number(heading.textContent?.split("·")[1]);
    });
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(36);
    for (const name of SECTION_NAMES) {
      const list = screen.getByRole("list", { name });
      expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(0);
    }
  });

  it("shows a due date with the actual day only for a request still waiting", async () => {
    stubPhone();
    open();
    const list = await rows();
    const finished = list.filter((row) => within(row).queryByText(/They said removed|Gone/));
    expect(finished.length).toBeGreaterThan(0);
    for (const row of finished) expect(row.textContent).not.toMatch(/due /);
    const waiting = list.filter((row) => within(row).queryByText("Waiting on them"));
    expect(waiting.some((row) => /due [A-Z][a-z]{2} \d{1,2}/.test(row.textContent ?? ""))).toBe(
      true,
    );
  });

  it("keeps what was asked off the rows and shows only the channel and the one date that matters", async () => {
    open();
    const list = await rows();
    const text = list.map((row) => row.textContent ?? "").join("\n");
    expect(text).not.toMatch(/stop selling|opt-out|None/);
    expect(text).toMatch(/email \u00b7 due [A-Z][a-z]{2} \d{1,2}/);
    expect(text).toMatch(/follow-up due [A-Z][a-z]{2} \d{1,2}/);
    const drafts = list.filter((row) => within(row).queryByText("Not sent yet"));
    expect(drafts.length).toBeGreaterThan(0);
    for (const row of drafts) expect(row.textContent).not.toMatch(/\u00b7 (due|sent) /);
  });

  it("says what to do next on a request that waits on the person, and nowhere else", async () => {
    open();
    const list = await rows();
    const steps =
      /Send a follow-up|Check the address|Open and answer them|Read their reply|Send a nudge/;
    const withStep = list.filter((row) => steps.test(row.textContent ?? ""));
    expect(withStep.length).toBeGreaterThan(0);
    for (const row of list.filter((row) => within(row).queryByText("Waiting on them"))) {
      expect(row.textContent).not.toMatch(steps);
    }
    const noAnswer = list.find((row) => within(row).queryByText("No answer"));
    expect(noAnswer).toHaveTextContent("Send a follow-up");
    const bounced = list.find((row) => within(row).queryByText("Email bounced"));
    expect(bounced).toHaveTextContent("Check the address");
  });

  it("tells a removal a scan verified from one the company only claimed", async () => {
    const mock = createMockApp();
    const verified = mock.store.requests.find((request) => request.verifiedGoneAt);
    if (!verified?.verifiedGoneAt) throw new Error("fixture");
    open("/requests", mock);
    const list = await rows();
    const day = formatShortDate(verified.verifiedGoneAt);
    expect(
      list.filter((row) => row.textContent?.includes(`Gone \u00b7 checked ${day}`)),
    ).toHaveLength(1);
    expect(list.some((row) => within(row).queryByText("They said removed"))).toBe(true);
  });

  it("counts the requests in the toolbar", async () => {
    open();
    await rows();
    expect(await screen.findByText("36 requests")).toBeVisible();
  });

  it("filters by status from the address bar", async () => {
    open("/requests?status=needs_verification");
    await waitFor(async () => expect((await rows()).length).toBe(2));
    expect(screen.getByRole("list", { name: "Active filters" })).toHaveTextContent(
      "Status: Prove it's you",
    );
    for (const row of await rows()) expect(within(row).getByText("Prove it's you")).toBeVisible();
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
    await user.click(screen.getByRole("button", { name: "Remove Status: Prove it's you" }));
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
    expect(screen.getAllByRole("link", { name: "Send requests" }).length).toBeGreaterThan(0);
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

  it("lists every profile's requests, with the owner named, when asked for all profiles", async () => {
    const { user, mock } = open();
    const own = (await rows()).length;
    await user.click(screen.getByRole("button", { name: "Profile: Jordan Example" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "All profiles" }));
    await waitFor(async () => expect((await rows()).length).toBe(mock.store.requests.length));
    expect(mock.store.requests.length).toBeGreaterThan(own);
    expect(screen.getAllByText(/Riley Sample/).length).toBeGreaterThan(0);
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

describe("grouping by batch", () => {
  it("groups the rows under one labelled section per batch, with a summary", async () => {
    const { user } = open();
    await rows();
    await user.click(screen.getByRole("radio", { name: "By batch" }));
    const headings = await screen.findAllByRole("heading", { name: /sites? \u00b7 \d+$/i });
    expect(headings.length).toBeGreaterThanOrEqual(2);
    expect(headings[0]).toHaveTextContent(/stop selling|delete/);
    expect(screen.getAllByText(/\d+ sent/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: /^Needs a look/ })).not.toBeInTheDocument();
  });

  it("opens by batch from the address and offers no batches across every profile", async () => {
    const first = open("/requests?group=batch");
    expect(await screen.findByRole("radio", { name: "By batch" })).toBeChecked();
    expect(
      (await screen.findAllByRole("heading", { name: /sites? \u00b7 \d+$/i })).length,
    ).toBeGreaterThan(0);
    first.unmount();
    open("/requests?group=batch&profileId=all");
    await screen.findByLabelText("Filter requests");
    expect(screen.queryByRole("radio", { name: "By batch" })).not.toBeInTheDocument();
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
