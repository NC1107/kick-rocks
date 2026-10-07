import { screen } from "@testing-library/react";
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

  it("shows each recipe with its health, and the sources with their licenses", async () => {
    open("findrecord");
    await screen.findByRole("heading", { name: "Automation" });
    expect(screen.getByText("Broken")).toBeVisible();
    expect(screen.getByText("Healthy")).toBeVisible();
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

  it("says plainly when a company has no saved steps", async () => {
    open("larkspur-bank");
    expect(await screen.findByText("No saved steps for this site")).toBeVisible();
    expect(screen.getByText("Nothing beyond sending the request.")).toBeVisible();
  });

  it("warns that a target without contact details is skipped", async () => {
    open("greenway-utilities");
    expect(await screen.findByText("No way to contact them on file")).toBeVisible();
  });

  it("offers a way back when the target does not exist", async () => {
    open("not-a-target");
    expect(await screen.findByText("Target not found")).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to targets" })).toBeVisible();
  });

  it("offers another try when the server will not answer", async () => {
    open("findrecord", failing(/\/api\/targets\/findrecord/));
    expect(await screen.findByText("Could not load this target")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
