import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../../mock/app.js";
import { renderPage } from "../../../test/render.js";
import { Component as NewCampaignPage } from "./index.js";

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

const open = (route = "/campaigns/new", mock?: MockApp) =>
  renderPage(<NewCampaignPage />, { path: "/campaigns/new", route, ...(mock ? { mock } : {}) });

describe("the campaign builder", () => {
  it("asks for nothing until a group is chosen", async () => {
    open();
    expect(
      await screen.findByText("Pick a group and at least one right to see a preview."),
    ).toBeVisible();
    expect(
      within(screen.getByTestId("send-bar")).getByRole("button", { name: "Send requests" }),
    ).toBeDisabled();
  });

  it("shows the readout with zeros before anything is chosen", async () => {
    open();
    const preview = await screen.findByRole("region", { name: "Preview" });
    const counts = within(preview).getByRole("region", { name: "Counts by channel" });
    for (const label of ["email", "web form", "agent or you", "scan first", "skipped"]) {
      expect(within(counts).getByText(label).nextElementSibling).toHaveTextContent("0");
    }
  });

  it("counts a preset by channel and previews the email before anything is sent", async () => {
    const { user } = open();
    await user.click(
      await screen.findByRole("radio", { name: /Data brokers with an email address/ }),
    );
    const preview = await screen.findByRole("region", { name: "Preview" });
    const counts = within(preview).getByRole("region", { name: "Counts by channel" });
    await waitFor(() =>
      expect(within(counts).getByText("email").nextElementSibling).not.toHaveTextContent(/^0$/),
    );
    expect(within(counts).getByText("web form")).toBeVisible();
    expect(within(counts).getByText("scan first")).toBeVisible();
    expect(within(counts).getByText("skipped")).toBeVisible();
    expect(await within(preview).findByText("Email preview")).toBeVisible();
    expect(within(preview).getByText(/Privacy request KR-/)).toBeVisible();
  });

  it("lists why targets were skipped, grouped by reason", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /Everything/ }));
    await screen.findByText(/Skipped targets/);
    expect(screen.getByText("Already in progress")).toBeVisible();
  });

  it("sends the campaign after a confirmation and creates the requests", async () => {
    const { user, mock } = open();
    const before = mock.store.requests.length;
    await user.click(await screen.findByRole("radio", { name: /Everyday companies/ }));
    const send = within(screen.getByTestId("send-bar")).getByRole("button", {
      name: "Send requests",
    });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Send these requests?")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Send requests" }));
    await waitFor(() => expect(mock.store.requests.length).toBeGreaterThan(before));
    expect((await screen.findAllByText(/queued to send/)).length).toBeGreaterThan(0);
  });

  it("asks only to opt out until deletion is ticked", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /Everyday companies/ }));
    expect(screen.getByRole("checkbox", { name: /Opt out of sale/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Delete my data/ })).not.toBeChecked();
    expect(screen.getByText(/Companies may close accounts/)).toBeVisible();
  });

  it("shows the address the first email goes to", async () => {
    const { user } = open();
    await user.click(
      await screen.findByRole("radio", { name: /Data brokers with an email address/ }),
    );
    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(await within(preview).findByText(/\(privacy@[^)]+\)/)).toBeVisible();
  });

  it("will not preview with no right chosen", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /Everyday companies/ }));
    await user.click(screen.getByRole("checkbox", { name: /Opt out of sale/ }));
    expect(screen.getByText("Choose at least one.")).toBeVisible();
    expect(screen.queryByText("Email preview")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send requests" })).toBeDisabled();
  });

  it("starts from the targets chosen on the targets page", async () => {
    open("/campaigns/new?targets=audiencegrid,larkspur-bank");
    expect(await screen.findByText("2 targets selected")).toBeVisible();
    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(await within(preview).findByText("First targets · 1")).toBeVisible();
  });

  it("shows the size of the chosen group beside it", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /Everyday companies/ }));
    const row = screen.getByRole("radio", { name: /Everyday companies/ }).closest("label");
    await waitFor(() => expect(row).toHaveTextContent(/\d+ targets/));
  });

  it("summarizes the send in the bar once there is something to send", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /Everyday companies/ }));
    const bar = screen.getByTestId("send-bar");
    await waitFor(() => expect(bar).toHaveTextContent(/\d+ requests? · opt-out/));
  });

  it("explains a missing mailbox", async () => {
    const mock = createMockApp();
    const profile = mock.store.profiles[0];
    if (profile) {
      profile.mailboxConnected = false;
      profile.mailbox = null;
    }
    renderPage(<NewCampaignPage />, { path: "/campaigns/new", route: "/campaigns/new", mock });
    expect(await screen.findByText("No mailbox connected")).toBeVisible();
    expect(screen.getByRole("link", { name: "Connect a mailbox" })).toBeVisible();
  });

  it("offers another try when the preview fails", async () => {
    const { user } = open("/campaigns/new", failing(/campaigns\/preview/));
    await user.click(await screen.findByRole("radio", { name: /Everyday companies/ }));
    expect(await screen.findByText("Could not build the preview")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
