import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { stubPhone } from "../../test/screen.js";
import { instrument } from "../profiles/test-support.js";
import { Component as FindingsPage } from "./index.js";

const open = (route = "/findings", mock?: MockApp) =>
  renderPage(<FindingsPage />, {
    path: "/findings",
    route,
    ...(mock ? { mock } : {}),
  });

const tab = (name: RegExp) => screen.findByRole("tab", { name });

const records = async () =>
  within(await screen.findByRole("list", { name: "Records" })).getAllByRole("listitem");

describe("findings", () => {
  it("opens on what needs you, with a count on every group that has something", async () => {
    open();
    expect(await tab(/^Needs you\s*4$/)).toHaveAttribute("aria-selected", "true");
    for (const name of [
      /^In progress\s*3$/,
      /^Gone\s*1$/,
      /^Not listed\s*2$/,
      /^Not scanned\s*\d+$/,
    ]) {
      expect(screen.getByRole("tab", { name })).toBeVisible();
    }
  });

  it("rolls the sites up into one line under the title", async () => {
    open();
    expect(
      await screen.findByText(
        "Found on 6 sites \u00b7 4 need you \u00b7 3 in progress \u00b7 1 gone",
      ),
    ).toBeVisible();
  });

  it("lists every record flat, one row each, with the fit in plain words", async () => {
    open();
    const rows = await records();
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const sites = new Set(
      rows.map(
        (row) => within(row).getByText(/^(NameLookup|Cityfile|Kinsearch|KinSearch)/).textContent,
      ),
    );
    expect(sites.size).toBeGreaterThanOrEqual(3);
    const first = within(rows[0] as HTMLElement);
    expect(first.getByText(/^likely - .*match/)).toBeVisible();
    expect(first.getByRole("button", { name: "This is me" })).toBeVisible();
    expect(first.getByRole("button", { name: "Not me" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Review \d/ })).not.toBeInTheDocument();
  });

  it("shows no bar until something is picked, then removes everything picked in one call", async () => {
    const { user, mock } = open();
    const seen = instrument(mock);
    const before = mock.store.requests.length;
    const rows = await records();
    expect(screen.queryByRole("button", { name: /^Remove selected/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Select all" }));
    const remove = await screen.findByRole("button", { name: `Remove selected (${rows.length})` });
    expect(screen.getByRole("button", { name: `Not me (${rows.length})` })).toBeVisible();
    await user.click(remove);

    const rights = await screen.findByRole("dialog", { name: `Remove ${rows.length} records` });
    expect(within(rights).getByRole("checkbox", { name: /Opt out of sale/ })).toBeChecked();
    await user.click(within(rights).getByRole("button", { name: `Remove ${rows.length}` }));

    await waitFor(() => expect(mock.store.requests.length).toBe(before + rows.length));
    const bulk = seen.filter((request) => request.url.endsWith("/matches/decisions"));
    expect(bulk).toHaveLength(1);
    const body = bulk[0]?.json as { decisions: { matchId: string; decision: string }[] };
    const { decisions } = body;
    expect(decisions).toHaveLength(rows.length);
    expect(decisions.every((item) => item.decision === "mine")).toBe(true);
    expect(seen.some((request) => request.url.includes("/campaigns"))).toBe(false);
  });

  it("says not me to the picked records without asking for rights", async () => {
    const { user, mock } = open();
    const rows = await records();
    const notMine = () =>
      mock.store.matches.filter((match) => match.decision === "not_mine").length;
    const before = notMine();
    await user.click(within(rows[0] as HTMLElement).getByRole("checkbox"));
    await user.click(within(rows[1] as HTMLElement).getByRole("checkbox"));
    await user.click(await screen.findByRole("button", { name: "Not me (2)" }));
    await waitFor(() => expect(notMine()).toBe(before + 2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("removes one record from its own row", async () => {
    const { user, mock } = open();
    const before = mock.store.requests.length;
    const rows = await records();
    await user.click(within(rows[0] as HTMLElement).getByRole("button", { name: "This is me" }));
    const rights = await screen.findByRole("dialog", { name: "Remove this record" });
    await user.click(within(rights).getByRole("button", { name: "Remove this record" }));
    await waitFor(() => expect(mock.store.requests.length).toBe(before + 1));
  });

  it("puts a removal that ended without the record going under Needs you", async () => {
    open("/findings?show=needs_you");
    expect(await screen.findByText("No reply to the removal")).toBeVisible();
    expect(screen.getAllByText("Removal stuck").length).toBeGreaterThan(0);
  });

  it("states where a removal in progress stands, one row per site that opens the request", async () => {
    open("/findings?show=in_progress");
    expect(await screen.findByText("Listed again, removal reopened")).toBeVisible();
    const list = screen.getByRole("list", { name: "In progress" });
    expect(within(list).getAllByRole("link", { name: /^Open / }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Review \d/ })).not.toBeInTheDocument();
  });

  it("understands the filter names of the old listings address", async () => {
    open("/findings?show=removed");
    expect(await screen.findByText(/Removed, confirmed [A-Z][a-z]{2} \d+/)).toBeVisible();
    expect(screen.getByRole("tab", { name: /^Gone/ })).toHaveAttribute("aria-selected", "true");
  });

  it("shows cleared and paused sites under their own groups", async () => {
    const { user } = open();
    await user.click(await tab(/^Not listed/));
    expect(await screen.findByText("Nothing found is you")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: /^Not scanned/ }));
    expect(await screen.findByText(/Paused until/)).toBeVisible();
    expect(screen.getAllByText("Skipped").length).toBeGreaterThan(0);
  });
});

describe("findings on a phone", () => {
  it("stacks each record with full-height answers and keeps the controls in a menu elsewhere", async () => {
    stubPhone();
    const { user } = open();
    const rows = await records();
    expect(
      within(rows[0] as HTMLElement).getByRole("button", { name: "This is me" }),
    ).toBeVisible();
    expect(within(rows[0] as HTMLElement).getByRole("button", { name: "Not me" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: /^In progress/ }));
    const list = await screen.findByRole("list", { name: "In progress" });
    await user.click(within(list).getByRole("button", { name: "More for FindRecord" }));
    const menu = await screen.findByRole("menu");
    for (const name of ["Scan now", "Pause for 30 days", "Skip this site", "Rescan every..."]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeVisible();
    }
  });
});

describe("scanning without a campaign", () => {
  it("scans every site from the header, with the cost of past addresses stated", async () => {
    const { user, mock } = open();
    const seen = instrument(mock);
    const before = mock.store.scans.length;
    await user.click(await screen.findByRole("button", { name: "Scan all sites" }));
    const dialog = await screen.findByRole("dialog", { name: "Scan every people-search site?" });
    expect(within(dialog).getByText(/Searches each site once/)).toBeVisible();
    await user.click(within(dialog).getByRole("checkbox", { name: /Include past addresses/ }));
    expect(within(dialog).getByText(/Searches each site 2 times, slowly/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Start scans" }));

    await waitFor(() => expect(mock.store.scans.length).toBeGreaterThan(before));
    const post = seen.find(
      (request) => request.method === "POST" && request.url.endsWith("/scans"),
    );
    expect(post?.json).toEqual({ preset: "people_search", addresses: "all" });
    expect(seen.some((request) => request.url.includes("/campaigns"))).toBe(false);
  });

  it("leaves paused and skipped sites out and says so", async () => {
    const { user, mock } = open();
    await user.click(await screen.findByRole("button", { name: "Scan all sites" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Start scans" }));
    expect(
      await screen.findByText(/Held back:.*paused.*skipped|Held back:.*skipped.*paused/),
    ).toBeVisible();
    const paused = mock.store.scans.filter(
      (scan) => scan.targetId === "verifyfirst" && scan.taskStatus === "queued",
    );
    expect(paused).toHaveLength(0);
  });

  it("follows a site's own choice about past addresses and leaves the choice to it", async () => {
    stubPhone();
    const mock = createMockApp();
    const profileId = mock.store.profiles[0]?.id;
    mock.store.scanPreferences.set(`${profileId}:findrecord`, {
      mode: "auto",
      pausedUntil: null,
      rescanDays: null,
      autoRescan: true,
      includePastAddresses: true,
    });
    const { user } = open("/findings?show=in_progress", mock);
    const seen = instrument(mock);
    const list = await screen.findByRole("list", { name: "In progress" });
    const row = within(list)
      .getAllByRole("listitem")
      .find((item) => within(item).queryByText("FindRecord"));
    if (!row) throw new Error("FindRecord is not waiting");
    await user.click(within(row).getByRole("button", { name: "More for FindRecord" }));
    await user.click(await screen.findByRole("menuitem", { name: "Scan now" }));
    const dialog = await screen.findByRole("dialog", { name: "Scan FindRecord?" });
    expect(within(dialog).getByRole("checkbox", { name: /Include past addresses/ })).toBeChecked();
    expect(within(dialog).getByText(/Searches the site 2 times/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Start scans" }));
    await waitFor(() =>
      expect(
        seen.some((request) => request.method === "POST" && request.url.endsWith("/scans")),
      ).toBe(true),
    );
    const post = seen.find(
      (request) => request.method === "POST" && request.url.endsWith("/scans"),
    );
    expect(post?.json).toEqual({ targetIds: ["findrecord"] });
  });

  it("starts the first scan from an empty page", async () => {
    const mock = createMockApp();
    mock.store.scans = [];
    mock.store.matches = [];
    const { user } = open("/findings", mock);
    expect(await screen.findByText("Nothing scanned yet.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Start your first scan" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Start scans" }));
    await waitFor(() => expect(mock.store.scans.length).toBeGreaterThan(0));
  });
});

describe("controls for one site", () => {
  it("pauses a site from its row and moves it under paused", async () => {
    stubPhone();
    const { user, mock } = open("/findings?show=in_progress");
    const list = await screen.findByRole("list", { name: "In progress" });
    const row = within(list)
      .getAllByRole("listitem")
      .find((item) => within(item).queryByText("FindRecord"));
    if (!row) throw new Error("FindRecord is not waiting");
    await user.click(within(row).getByRole("button", { name: "More for FindRecord" }));
    await user.click(await screen.findByRole("menuitem", { name: "Pause for 30 days" }));
    await waitFor(() =>
      expect(
        mock.store.scanPreferences.get(`${mock.store.profiles[0]?.id}:findrecord`),
      ).toMatchObject({
        mode: "paused",
      }),
    );
    await waitFor(() => expect(within(list).queryByText("FindRecord")).not.toBeInTheDocument());
    const queued = mock.store.scans.filter(
      (scan) => scan.targetId === "findrecord" && scan.taskStatus === "queued",
    );
    expect(queued).toHaveLength(0);
  });

  it("offers to unskip and scan a skipped site", async () => {
    stubPhone();
    const { user } = open("/findings?show=not_scanned");
    await user.click(await screen.findByRole("button", { name: "More for ClearCheck" }));
    expect(await screen.findByRole("menuitem", { name: "Unskip and scan" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Skip this site" })).not.toBeInTheDocument();
  });
});
