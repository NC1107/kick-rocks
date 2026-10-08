import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../../mock/app.js";
import { renderPage } from "../../../test/render.js";
import { Component as TargetDetailPage } from "./index.js";

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

const open = (id: string, mock?: MockApp) =>
  renderPage(<TargetDetailPage />, {
    path: "/targets/:id",
    route: `/targets/${id}`,
    ...(mock ? { mock } : {}),
  });

describe("the target page", () => {
  it("explains what a people-search target asks of a person", async () => {
    open("findrecord");
    expect(await screen.findByRole("heading", { name: "FindRecord", level: 1 })).toBeVisible();
    expect(screen.getByText(/first scans for your record/)).toBeVisible();
    expect(screen.getByText(/A CAPTCHA stands in the way/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Ask to remove my data/ })).toHaveAttribute(
      "href",
      "/campaigns/new?targets=findrecord",
    );
    expect(screen.getByRole("link", { name: "View requests" })).toHaveAttribute(
      "href",
      "/requests?targetId=findrecord",
    );
  });

  it("explains in plain words why a target is hard", async () => {
    open("findrecord");
    const section = (await screen.findByRole("heading", { name: "Difficulty" })).closest("section");
    const difficulty = within(section as HTMLElement);
    expect(difficulty.getByText("Hard.")).toBeVisible();
    expect(
      difficulty.getByText("Your listing has to be found before it can be removed."),
    ).toBeVisible();
    expect(difficulty.getByText("It shows a CAPTCHA that only you can solve.")).toBeVisible();
    expect(
      difficulty.getByText("Its approved recipe is failing against the live site."),
    ).toBeVisible();
  });

  it("calls an email-only target easy and says why", async () => {
    open("audiencegrid");
    const section = (await screen.findByRole("heading", { name: "Difficulty" })).closest("section");
    const difficulty = within(section as HTMLElement);
    expect(difficulty.getByText("Easy.")).toBeVisible();
    expect(
      difficulty.getByText("It takes requests at its own privacy email address."),
    ).toBeVisible();
  });

  it("shows each recipe with its health, and the sources with their licenses", async () => {
    open("findrecord");
    await screen.findByRole("heading", { name: "Automation" });
    const recipes = screen.getByRole("region", { name: "Recipes for this target" });
    const [scan, removal] = within(recipes).getAllByRole("row").slice(1);
    expect(scan).toHaveTextContent("Healthy");
    expect(removal).toHaveTextContent("Broken");
    expect(screen.getByText("Big Ass Data Broker Opt-Out List")).toBeVisible();
    expect(screen.getByText("CC BY-NC-SA 4.0")).toBeVisible();
  });

  it("drops the version and source columns on a phone, so the health column fits", async () => {
    open("findrecord");
    await screen.findByRole("heading", { name: "Automation" });
    for (const name of ["Version", "Source"]) {
      expect(screen.getByRole("columnheader", { name })).toHaveClass("hidden", "sm:table-cell");
    }
    expect(screen.getByRole("columnheader", { name: "Health" })).not.toHaveClass("hidden");
  });

  it("tags what needs the person and leaves the rest as plain tags", async () => {
    open("findrecord");
    await screen.findByRole("heading", { name: /Asks of you/, level: 2 });
    expect(screen.getByText("CAPTCHA")).toHaveAttribute("data-tone", "attention");
    expect(screen.getByText("Record URL")).toHaveAttribute("data-tone", "neutral");
  });

  it("says plainly when a company has no saved steps", async () => {
    open("larkspur-bank");
    expect(await screen.findByText("No saved steps for this target.")).toBeVisible();
    expect(screen.getByText("Nothing beyond sending the request.")).toBeVisible();
  });

  it("warns that a target without contact details is skipped", async () => {
    open("greenway-utilities");
    expect(await screen.findByText("No way to contact them on file")).toBeVisible();
  });

  it("opens a target that left the dataset, with the source it was stored under", async () => {
    const mock = createMockApp();
    const base = mock.store.targets.find((target) => target.id === "findrecord");
    if (!base) throw new Error("the mock has no findrecord target");
    mock.store.targets.push({
      ...base,
      id: "audiencepoint-inc",
      name: "AudiencePoint",
      retired: true,
      sources: [{ source: "ca-registry-2025", license: "public-record" }],
    });
    open("audiencepoint-inc", mock);
    expect(await screen.findByRole("heading", { name: "AudiencePoint", level: 1 })).toBeVisible();
    expect(screen.getByText("California Data Broker Registry 2025")).toBeVisible();
  });

  it("offers a way back when the target does not exist", async () => {
    open("not-a-target");
    expect(await screen.findByText("Target not found.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to targets" })).toBeVisible();
  });

  it("offers another try when the server will not answer", async () => {
    open("findrecord", failing(/\/api\/targets\/findrecord/));
    expect(await screen.findByText("Could not load this target")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

describe("the visit history on a target page", () => {
  it("shows how many visits a site has had today and that it is cooling down", async () => {
    open("peopletrace");
    expect(await screen.findByRole("heading", { name: "Visits", level: 2 })).toBeVisible();
    expect(await screen.findByText("2 of 6")).toBeVisible();
    expect(screen.getByText("Resumes")).toBeVisible();
    expect(screen.getByText(/Too many requests/)).toBeVisible();
  });

  it("prints a dash, not a word, when a site has never pushed back", async () => {
    open("namelookup");
    expect(await screen.findByText("Last pushback")).toBeVisible();
    expect(screen.getByText("-")).toBeVisible();
    expect(screen.queryByText("None")).toBeNull();
  });

  it("says nothing has visited a site that was never visited", async () => {
    open("findrecord");
    expect(await screen.findByText(/Nothing has visited this site yet/)).toBeVisible();
  });
});
