import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { stubPhone } from "../../test/screen.js";
import { Component as HomePage } from "../dashboard/index.js";
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
    expect(await tab(/^Is this you\?\s*3$/)).toHaveAttribute("aria-selected", "true");
    for (const name of [
      /^Stuck\s*1$/,
      /^In progress\s*2$/,
      /^Gone\s*1$/,
      /^Not listed\s*2$/,
      /^Not checked\s*\d+$/,
    ]) {
      expect(screen.getByRole("tab", { name })).toBeVisible();
    }
  });

  it("states the same listed, to confirm, in progress and gone numbers as Home", async () => {
    const mock = createMockApp();
    const findings = open("/findings", mock);
    const footer = await screen.findByText(/^Listed on \d+ sites?/);
    const listed = Number(/Listed on (\d+)/.exec(footer.textContent ?? "")?.[1]);
    const tabCount = (name: RegExp) =>
      Number(/(\d+)$/.exec(screen.getByRole("tab", { name }).textContent ?? "")?.[1]);
    const counts = [
      tabCount(/^Is this you/),
      tabCount(/^Stuck/),
      tabCount(/^In progress/),
      tabCount(/^Gone/),
    ];
    findings.unmount();

    renderPage(<HomePage />, { mock });
    const hero = (await screen.findByRole("heading", { name: "Where you're listed" })).closest(
      "section",
    ) as HTMLElement;
    expect(hero).toHaveTextContent(`Listed on ${listed} sites`);
    expect(hero).toHaveTextContent(
      `${counts[0]} to confirm \u00b7 ${counts[1]} stuck \u00b7 ${counts[2]} in progress \u00b7 ${counts[3]} gone`,
    );
  });

  it("has no subtitle under the title", async () => {
    open();
    await tab(/^Is this you/);
    expect(screen.queryByText(/need you/)).toBeNull();
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
    expect(first.getByText("likely")).toBeVisible();
    expect(first.getByRole("button", { name: "Not me" })).toBeVisible();
    expect(first.queryByRole("button", { name: "This is me" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Review \d/ })).not.toBeInTheDocument();
  });

  it("keeps one primary button in the list header, labelled by what it will do", async () => {
    const { user } = open();
    const rows = await records();
    expect(
      await screen.findByRole("button", { name: /^Remove me from \d+ sites?$/ }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Not me \(/ })).toBeNull();

    await user.click(within(rows[0] as HTMLElement).getByRole("checkbox"));
    expect(await screen.findByRole("button", { name: "Remove 1 selected" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Remove me from/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Not me (1 selected)" })).toBeVisible();
  });

  it("removes every waiting record from the header when nothing is picked", async () => {
    const { user, mock } = open();
    const seen = instrument(mock);
    const before = mock.store.requests.length;
    const rows = await records();
    await user.click(await screen.findByRole("button", { name: /^Remove me from \d+ sites?$/ }));

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
    await user.click(await screen.findByRole("button", { name: "Not me (2 selected)" }));
    await waitFor(() => expect(notMine()).toBe(before + 2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("removes only the picked records", async () => {
    const { user, mock } = open();
    const before = mock.store.requests.length;
    const rows = await records();
    await user.click(within(rows[0] as HTMLElement).getByRole("checkbox"));
    await user.click(within(rows[1] as HTMLElement).getByRole("checkbox"));
    await user.click(await screen.findByRole("button", { name: "Remove 2 selected" }));
    const rights = await screen.findByRole("dialog", { name: "Remove 2 records" });
    await user.click(within(rights).getByRole("button", { name: "Remove 2" }));
    await waitFor(() => expect(mock.store.requests.length).toBe(before + 2));
  });

  it("says not me to one record from its own row", async () => {
    const { user, mock } = open();
    const notMine = () =>
      mock.store.matches.filter((match) => match.decision === "not_mine").length;
    const before = notMine();
    const rows = await records();
    await user.click(within(rows[0] as HTMLElement).getByRole("button", { name: "Not me" }));
    await waitFor(() => expect(notMine()).toBe(before + 1));
  });

  it("puts a removal that ended without the record going under Stuck", async () => {
    open("/findings?show=stuck");
    expect(await screen.findByText("No reply")).toBeVisible();
    expect(screen.getAllByText("Stuck").length).toBeGreaterThan(0);
  });

  it("states where a removal in progress stands, one row per site that opens the request", async () => {
    open("/findings?show=in_progress");
    expect(await screen.findByText("Listed again, removal reopened")).toBeVisible();
    const list = screen.getByRole("list", { name: "In progress" });
    expect(within(list).getAllByRole("link", { name: /^Open / }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Review \d/ })).not.toBeInTheDocument();
  });

  it("says a site's word of removal is not yet checked, and that we check again", async () => {
    open("/findings?show=in_progress");
    expect(await screen.findByText("They said removed · we check again")).toBeVisible();
  });

  it("understands the filter names of the old listings address", async () => {
    open("/findings?show=removed");
    expect(await screen.findByText(/^Checked [A-Z][a-z]{2} \d+ · no longer listed$/)).toBeVisible();
    expect(screen.getByRole("tab", { name: /^Gone/ })).toHaveAttribute("aria-selected", "true");
  });

  it("shows cleared and paused sites under their own groups", async () => {
    const { user } = open();
    await user.click(await tab(/^Not listed/));
    expect(await screen.findByText("Nothing found is you")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: /^Not checked/ }));
    expect(await screen.findByText(/Paused until/)).toBeVisible();
    expect(screen.getAllByText("Skipped").length).toBeGreaterThan(0);
  });
});

describe("findings on a phone", () => {
  it("stacks each record with full-height answers and keeps the controls in a menu elsewhere", async () => {
    stubPhone();
    const { user } = open();
    const rows = await records();
    expect(within(rows[0] as HTMLElement).getByRole("button", { name: "Not me" })).toBeVisible();
    expect(screen.getByRole("tablist", { name: "Findings" }).className).toContain(
      "max-sm:flex-wrap",
    );

    await user.click(screen.getByRole("tab", { name: /^Not checked/ }));
    const list = await screen.findByRole("list", { name: "Not checked" });
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
    const { user } = open("/findings?show=not_scanned", mock);
    const seen = instrument(mock);
    const list = await screen.findByRole("list", { name: "Not checked" });
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
    const { user, mock } = open("/findings?show=not_scanned");
    const list = await screen.findByRole("list", { name: "Not checked" });
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
    await waitFor(() => expect(within(list).getAllByText(/^Paused until/).length).toBe(2));
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
