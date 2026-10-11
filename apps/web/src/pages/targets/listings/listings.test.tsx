import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../../mock/app.js";
import { renderPage } from "../../../test/render.js";
import { stubPhone } from "../../../test/screen.js";
import { instrument } from "../../profiles/test-support.js";
import { Component as ListingsPage } from "./index.js";

const open = (route = "/targets/listings", mock?: MockApp) =>
  renderPage(<ListingsPage />, {
    path: "/targets/listings",
    route,
    ...(mock ? { mock } : {}),
  });

const chip = (name: RegExp) => screen.findByRole("button", { name });

describe("where you're listed", () => {
  it("opens on what needs you, with a count on every filter", async () => {
    open();
    expect(await chip(/^Needs you\s*3$/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Yours\s*2$/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    for (const name of [/^Removed\s*1$/, /^Not found\s*2$/, /^Waiting\s*2$/, /^Not scanned\s*1$/]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }
    expect(screen.getByRole("button", { name: /^Paused or skipped\s*2$/ })).toBeVisible();
  });

  it("lists the sites that need an answer as a table on a wide screen", async () => {
    open();
    const region = await screen.findByRole("region", { name: "Sites" });
    const table = within(region);
    const rows = table.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("NameLookup")]),
    );
    expect(table.getAllByText("2 records to confirm").length).toBe(1);
    for (const heading of ["Site", "Status", "Records", "Last scan", "Next scan"]) {
      expect(table.getByRole("columnheader", { name: heading })).toBeVisible();
    }
  });

  it("states where each site stands in plain words", async () => {
    open("/targets/listings?show=yours");
    expect(await screen.findByText("Listed again, removal reopened")).toBeVisible();
    expect(screen.getByText("No reply to the removal")).toBeVisible();
  });

  it("shows removed, not found and paused sites under their own filters", async () => {
    const { user } = open();
    await user.click(await chip(/^Removed/));
    expect(await screen.findByText(/Removed, confirmed [A-Z][a-z]{2} \d+/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^Not found/ }));
    expect(await screen.findByText("Nothing found is you")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^Paused or skipped/ }));
    expect(await screen.findByText(/Paused until/)).toBeVisible();
    const skipped = await screen.findByRole("button", { name: /Skipped \(1\)/ });
    await user.click(skipped);
    expect(screen.getAllByText("ClearCheck").length).toBeGreaterThan(0);
  });

  it("opens the records of a site and removes one without making a campaign", async () => {
    const { user, mock } = open();
    const seen = instrument(mock);
    const campaigns = mock.store.requests.filter((request) => request.campaignId).length;
    const before = mock.store.requests.length;

    await user.click(await screen.findByRole("button", { name: "Review 2" }));
    const dialog = await screen.findByRole("dialog", { name: "NameLookup" });
    const records = within(dialog).getByRole("list", { name: "Records on NameLookup" });
    expect(within(records).getAllByRole("listitem")).toHaveLength(2);
    await user.click(
      within(records).getAllByRole("button", { name: "This is me" })[0] as HTMLElement,
    );

    const rights = await screen.findByRole("dialog", { name: "Remove this record" });
    expect(within(rights).getByRole("checkbox", { name: /Opt out of sale/ })).toBeChecked();
    await user.click(within(rights).getByRole("button", { name: "Remove this record" }));

    await waitFor(() => expect(mock.store.requests.length).toBe(before + 1));
    expect(mock.store.requests.filter((request) => request.campaignId).length).toBe(campaigns);
    expect(seen.some((request) => request.url.includes("/campaigns"))).toBe(false);
    expect(seen.some((request) => request.url.includes("/decision"))).toBe(true);
  });

  it("says no to a record in one tap", async () => {
    const { user, mock } = open();
    const notMine = () =>
      mock.store.matches.filter((match) => match.decision === "not_mine").length;
    const before = notMine();
    await user.click(await screen.findByRole("button", { name: "Review 2" }));
    const dialog = await screen.findByRole("dialog", { name: "NameLookup" });
    await user.click(within(dialog).getAllByRole("button", { name: "Not me" })[0] as HTMLElement);
    await waitFor(() => expect(notMine()).toBe(before + 1));
  });
});

describe("where you're listed on a phone", () => {
  it("puts the records under the site row and the controls in an overflow menu", async () => {
    stubPhone();
    const { user } = open();
    const list = await screen.findByRole("list", { name: "Sites" });
    expect(screen.queryByRole("region", { name: "Sites" })).not.toBeInTheDocument();
    const nameLookup = within(list)
      .getAllByRole("listitem")
      .find((item) => within(item).queryByText("2 records to confirm"));
    if (!nameLookup) throw new Error("NameLookup is not listed");
    const row = within(nameLookup);
    expect(row.getByRole("list", { name: "Records on NameLookup" })).toBeVisible();
    expect(row.getAllByRole("button", { name: "This is me" })).toHaveLength(2);
    expect(row.getByText(/^Scanned/)).toBeVisible();

    await user.click(row.getByRole("button", { name: "More for NameLookup" }));
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
    expect(within(dialog).getByText(/Searches each site 2 times, spaced out/)).toBeVisible();
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

  it("starts the first scan from an empty page", async () => {
    const mock = createMockApp();
    mock.store.scans = [];
    mock.store.matches = [];
    const { user } = open("/targets/listings", mock);
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
    const { user, mock } = open("/targets/listings?show=waiting");
    const list = await screen.findByRole("list", { name: "Sites" });
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
    const { user } = open("/targets/listings?show=paused");
    await user.click(await screen.findByRole("button", { name: /Skipped \(1\)/ }));
    await user.click(await screen.findByRole("button", { name: "More for ClearCheck" }));
    expect(await screen.findByRole("menuitem", { name: "Unskip and scan" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Skip this site" })).not.toBeInTheDocument();
  });
});
