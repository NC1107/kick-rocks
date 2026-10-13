import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../../mock/app.js";
import { assessed } from "../../../../mock/targets.js";
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
  it("starts with the easiest group and a right chosen, so the preview is never empty", async () => {
    open();
    const radios = await screen.findAllByRole("radio");
    expect(radios[0]).toHaveAccessibleName(/Easiest first/);
    expect(radios[0]).toBeChecked();
    expect(screen.getByRole("heading", { name: "Send requests", level: 1 })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Stop selling my data/ })).toBeChecked();
    expect(screen.queryByText(/Pick a group and a right/)).not.toBeInTheDocument();
    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(await within(preview).findByRole("region", { name: "Counts by channel" })).toBeVisible();
    await waitFor(() =>
      expect(
        within(screen.getByTestId("send-bar")).getByRole("button", { name: "Send requests" }),
      ).toBeEnabled(),
    );
  });

  it("words the groups as one short line each, with no sentence under them", async () => {
    open();
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /^Everything \(\d+\)/ })).toBeVisible(),
    );
    for (const label of [
      "Easiest first",
      "Sites that answer by email",
      "Everyday companies",
      "People-search sites",
    ]) {
      expect(screen.getByRole("radio", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    expect(screen.queryByText(/Fully automatic|Scanned first/)).not.toBeInTheDocument();
  });

  it("links the profile in the header and goes back to Sites when it came from there", async () => {
    open("/campaigns/new?targets=audiencegrid");
    const profile = await screen.findByRole("link", { name: "Jordan Example" });
    expect(profile).toHaveAttribute("href", expect.stringMatching(/^\/profiles\/prf_/));
    expect(screen.getByRole("link", { name: /Sites/ })).toHaveAttribute("href", "/targets");
  });

  it("counts a preset by channel and previews the email before anything is sent", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /Sites that answer by email/ }));
    const preview = await screen.findByRole("region", { name: "Preview" });
    const counts = within(preview).getByRole("region", { name: "Counts by channel" });
    await waitFor(() =>
      expect(within(counts).getByText("email").nextElementSibling).not.toHaveTextContent(/^0$/),
    );
    const values = [...counts.querySelectorAll("div > span:last-child")].map(
      (value) => value.textContent,
    );
    expect(values.length).toBeGreaterThan(0);
    expect(values).not.toContain("0");
    expect(await within(preview).findByText("Email preview")).toBeVisible();
    expect(within(preview).getByText(/Privacy request KR-/)).toBeVisible();
  });

  it("labels the confirm dialog rows in plain words", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /Sites that answer by email/ }));
    const send = within(screen.getByTestId("send-bar")).getByRole("button", {
      name: "Send requests",
    });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Asking for")).toBeVisible();
    expect(dialog.getByText("Stop selling my data")).toBeVisible();
  });

  it("lists why targets were skipped, grouped by reason", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /Everything/ }));
    await screen.findByText(/Skipped sites/);
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
    expect(screen.getByRole("checkbox", { name: /Stop selling my data/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Delete my data/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Delete my data/ })).toBeDisabled();
    expect(screen.getByText(/Pick sites to delete/)).toBeVisible();
  });

  it("shows the address the first email goes to", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /Sites that answer by email/ }));
    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(await within(preview).findByText(/\(privacy@[^)]+\)/)).toBeVisible();
  });

  it("will not preview with no right chosen", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /Everyday companies/ }));
    await user.click(screen.getByRole("checkbox", { name: /Stop selling my data/ }));
    expect(screen.getByText("Choose at least one.")).toBeVisible();
    expect(screen.queryByText("Email preview")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nothing to send" })).toBeDisabled();
  });

  it("starts from the targets chosen on the targets page", async () => {
    open("/campaigns/new?targets=audiencegrid,larkspur-bank");
    expect(await screen.findByText("2 sites selected")).toBeVisible();
    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(await within(preview).findByText("First sites · 1")).toBeVisible();
  });

  it("offers the easy ones first, with how many there are", async () => {
    const { user, mock } = open();
    const easy = mock.store.targets.filter((target) => assessed(target).difficulty === "easy");
    const radios = await screen.findAllByRole("radio");
    expect(radios[0]).toHaveAccessibleName(/Easiest first/);
    const row = radios[0]?.closest("label");
    expect(easy.length).toBeGreaterThan(0);
    await waitFor(() => expect(row).toHaveTextContent(/\d+ new/));
    await user.click(radios[0] as HTMLElement);
    const preview = await screen.findByRole("region", { name: "Preview" });
    const counts = within(preview).getByRole("region", { name: "Counts by channel" });
    await waitFor(() =>
      expect(within(counts).getByText("email").nextElementSibling).not.toHaveTextContent(/^0$/),
    );
    expect(within(counts).queryByText("agent or you")).toBeNull();
  });

  it("lets the person say not to be checked with, and keeps it", async () => {
    const mock = createMockApp();
    const { user } = open(undefined, mock);
    const check = await screen.findByRole("radio", { name: /^Check with me/ });
    await waitFor(() => expect(check).toBeChecked());
    await user.click(screen.getByRole("radio", { name: /^Just do it/ }));
    await waitFor(() => expect(mock.store.settings.agent.autopilot).toBe(true));
    await waitFor(() => expect(screen.getByRole("radio", { name: /^Just do it/ })).toBeChecked());
  });

  it("picks single targets right on the page, with search", async () => {
    const { user } = open();
    await user.click(await screen.findByText("Search and pick sites"));
    await user.type(await screen.findByRole("searchbox", { name: "Search sites" }), "pawprint");
    const box = await screen.findByRole("checkbox", { name: "Pick Pawprint Pet Supply" });
    await user.click(box);
    expect(await screen.findByText("1 site selected")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Pick Pawprint Pet Supply" })).toBeChecked();
    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(await within(preview).findByText("First sites · 1")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Pick Pawprint Pet Supply" }));
    await waitFor(() => expect(screen.queryByText("1 site selected")).not.toBeInTheDocument());
  });

  it("narrows the picker by difficulty", async () => {
    const { user } = open();
    await user.click(await screen.findByText("Search and pick sites"));
    const list = await screen.findByRole("list", { name: "Pick sites" });
    await within(list).findAllByRole("checkbox");
    const all = screen.getAllByText(/^\d+ sites?$/)[0]?.textContent;
    await user.click(screen.getByRole("button", { name: /Filters/ }));
    await user.selectOptions(await screen.findByLabelText("Difficulty"), "easy");
    expect(await screen.findByText("Difficulty: Easy")).toBeVisible();
    await waitFor(() => expect(screen.getAllByText(/^\d+ sites?$/)[0]?.textContent).not.toBe(all));
    const rows = within(screen.getByRole("list", { name: "Pick sites" })).getAllByRole("listitem");
    for (const row of rows) expect(within(row).queryByText("hard")).toBeNull();
  });

  it("turns the picker's filter into the campaign's selection", async () => {
    const { user } = open();
    await user.click(await screen.findByText("Search and pick sites"));
    await user.click(await screen.findByRole("button", { name: /Filters/ }));
    await user.selectOptions(await screen.findByLabelText("Difficulty"), "easy");
    await user.click(await screen.findByRole("button", { name: /^Use all \d+ sites? matching$/ }));
    expect(await screen.findByText(/\d+ sites match your filters/)).toBeVisible();
    expect(screen.getByText("Difficulty: Easy")).toBeVisible();
  });

  it("replaces the picked targets when a group is chosen", async () => {
    const { user } = open("/campaigns/new?targets=larkspur-bank");
    expect(await screen.findByText("1 site selected")).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /Everyday companies/ }));
    await waitFor(() => expect(screen.queryByText("1 site selected")).not.toBeInTheDocument());
    expect(screen.getByRole("radio", { name: /Everyday companies/ })).toBeChecked();
  });

  it("starts from a filter handed over by the targets page", async () => {
    const filter = encodeURIComponent('{"difficulty":"easy"}');
    open(`/campaigns/new?filter=${filter}`);
    expect(await screen.findByText(/\d+ sites match your filters/)).toBeVisible();
    expect(screen.getByText("Difficulty: Easy")).toBeVisible();
    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(await within(preview).findByText(/First sites · \d+/)).toBeVisible();
  });

  it("shows the server's cap message when a filter matches too many targets", async () => {
    const message =
      "That filter matches 6200 targets, and one request takes at most 5000. Narrow the filter and try again.";
    const mock = createMockApp();
    const handle = mock.handle.bind(mock);
    mock.handle = async (request) =>
      /campaigns\/preview/.test(request.url)
        ? {
            status: 422,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ error: "selection_too_large", message }),
          }
        : handle(request);
    open("/campaigns/new?filter=%7B%7D", mock);
    expect(await screen.findByText(message)).toBeVisible();
  });

  it("warns before sending that form-only requests will wait for a person", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /^Everything/ }));
    const notice = await screen.findByText(/will wait for you/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(notice.closest("p")).toHaveTextContent(/\d+ requests will wait for you/);
    expect(notice.closest("p")).toHaveTextContent("no working recipe");
    expect(notice.closest("p")).toHaveTextContent("no agent has connected");
  });

  it("does not warn once an agent worker has been seen", async () => {
    const mock = createMockApp();
    mock.store.settings.worker.model = {
      workerId: "agent-home",
      version: "agent-0.1.0",
      lastSeenAt: new Date().toISOString(),
      busy: false,
      currentTaskId: null,
    };
    const { user } = open("/campaigns/new", mock);
    await user.click(await screen.findByRole("radio", { name: /^Everything/ }));
    await screen.findByText(/First sites/);
    expect(screen.queryByText(/will wait for you/)).not.toBeInTheDocument();
  });

  it("says a filter campaign only asks companies to stop selling", async () => {
    open(`/campaigns/new?filter=${encodeURIComponent('{"kind":"company"}')}`);
    expect(await screen.findByRole("checkbox", { name: /Delete my data/ })).toBeDisabled();
    expect(screen.getByText(/Pick sites to delete/)).toBeVisible();
    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(await within(preview).findByText("Email preview")).toBeVisible();
    expect(within(preview).queryByText(/delete the personal information/)).not.toBeInTheDocument();
  });

  it("does not bring a group back after the picked targets are cleared", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /Easiest first/ }));
    await user.click(screen.getByText("Search and pick sites"));
    await user.type(await screen.findByRole("searchbox", { name: "Search sites" }), "pawprint");
    await user.click(await screen.findByRole("checkbox", { name: "Pick Pawprint Pet Supply" }));
    expect(await screen.findByText("1 site selected")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear sites" }));
    expect(screen.queryByText("1 site selected")).not.toBeInTheDocument();
    const groups = screen.getByRole("group", { name: "Group of sites" });
    for (const radio of within(groups).getAllByRole("radio")) expect(radio).not.toBeChecked();
    expect(screen.getByText("Search and pick sites").closest("summary")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Nothing to send" })).toBeDisabled();
  });

  it("says how many targets in the chosen group are new and how many are already handled", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /Everyday companies/ }));
    const row = screen.getByRole("radio", { name: /Everyday companies/ }).closest("label");
    await waitFor(() => expect(row).toHaveTextContent(/\d+ new, \d+ already handled/));
  });

  it("summarizes the send in the bar once there is something to send", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: /Everyday companies/ }));
    const bar = screen.getByTestId("send-bar");
    await waitFor(() =>
      expect(bar).toHaveTextContent(/\d+ (emails?|web forms?|scans? first)[^·]* ready/),
    );
    expect(bar).not.toHaveTextContent(/opt-out/);
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
