import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { Component as AdvancedPage } from "./advanced/index.js";
import { Component as SetupPage } from "./index.js";

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

const setup = (mock = createMockApp()) =>
  renderPage(<SetupPage />, { path: "/settings", route: "/settings", mock });
const advanced = (mock = createMockApp()) =>
  renderPage(<AdvancedPage />, {
    path: "/settings/advanced",
    route: "/settings/advanced",
    mock,
  });

describe("the settings tab titles", () => {
  it("gives each section its own title", async () => {
    advanced();
    await screen.findByRole("heading", { name: "Settings", level: 1 });
    expect(document.title).toBe("Advanced - Settings - Kick Rocks");
  });

  it("titles the setup section on its own", async () => {
    setup();
    await screen.findByRole("heading", { name: "Settings", level: 1 });
    expect(document.title).toBe("Setup - Settings - Kick Rocks");
  });
});

describe("the way to mail intake", () => {
  it("links to the section on the profile's mailbox page", async () => {
    const mock = createMockApp();
    setup(mock);
    const link = await screen.findByRole("link", { name: "Open" });
    expect(link).toHaveAttribute("href", `/profiles/${mock.store.profiles[0]?.id}/mailbox#intake`);
    expect(screen.getAllByText("Mailbox").length).toBeGreaterThan(0);
  });

  it("no longer lists the saved mail it would remove", async () => {
    setup();
    await screen.findByRole("link", { name: "Open" });
    expect(screen.queryByTestId("cleanup-preview")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Old mail Kick Rocks saved/ })).toBeNull();
  });
});

describe("the setup page", () => {
  it("lists mailbox, profile, laws, helpers, and account in that order", async () => {
    setup();
    await screen.findByRole("heading", { name: "Helpers" });
    await screen.findByRole("heading", { name: /^Privacy laws/ });
    const labels = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent ?? "");
    const order = ["Mailbox", "Profile", "Privacy laws", "Helpers", "Account"].map((name) =>
      labels.findIndex((text) => text.startsWith(name)),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("renders the helpers under the id the header chip links to", async () => {
    setup();
    const heading = await screen.findByRole("heading", { name: "Helpers" });
    const anchor = heading.closest("#helpers");
    expect(anchor).not.toBeNull();
    expect(anchor).toContainElement(await screen.findByText("Browser worker"));
  });

  it("has no subtitle that lists the sections", async () => {
    setup();
    await screen.findByRole("heading", { name: "Settings", level: 1 });
    expect(screen.queryByText(/Password, mailbox, laws, and helpers/)).toBeNull();
  });

  it("leads the mailbox with its state, the address, and the last check", async () => {
    const mock = createMockApp();
    setup(mock);
    const link = await screen.findByRole("link", { name: "Open" });
    await screen.findByText("jordan@example.com");
    const row = link.closest("[data-row]") as HTMLElement;
    expect(row).toHaveTextContent(/^Connected · jordan@example\.com · checked .+ ago/);
  });

  it("offers Connect when the profile has no mailbox", async () => {
    const mock = createMockApp();
    const jordan = mock.store.profiles[0];
    if (jordan) {
      jordan.mailbox = null;
      jordan.mailboxConnected = false;
    }
    setup(mock);
    expect(await screen.findByText("Not connected")).toBeVisible();
    expect(screen.getByRole("link", { name: "Connect" })).toHaveAttribute(
      "href",
      `/profiles/${jordan?.id}/mailbox`,
    );
  });

  it("shows the profile as one row that leads to it", async () => {
    const mock = createMockApp();
    setup(mock);
    const link = await screen.findByRole("link", { name: "Jordan Example · California" });
    expect(link).toHaveAttribute("href", `/profiles/${mock.store.profiles[0]?.id}`);
  });

  it("offers to create a profile when there is none", async () => {
    const mock = createMockApp();
    mock.store.profiles.length = 0;
    setup(mock);
    expect(await screen.findByRole("link", { name: "No profile yet · Create" })).toHaveAttribute(
      "href",
      "/profiles/new",
    );
  });

  it("keeps the password collapsed until the Password row is opened", async () => {
    const { user } = setup();
    const row = await screen.findByRole("button", { name: /^Password/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Current password")).toBeNull();
    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Current password")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

const field = (label: RegExp | string) => screen.findByLabelText(label);

describe("general settings", () => {
  it("shows the saved schedule", async () => {
    advanced();
    expect(await field(/Check inbox every/)).toHaveValue(15);
    expect(screen.getByLabelText(/Follow-ups/)).toHaveValue(2);
  });

  it("lets the person allow the agent worker onto unreviewed sites, and take it back", async () => {
    const { user, mock } = advanced();
    const box = await screen.findByRole("checkbox", {
      name: /Take unreviewed targets/,
    });
    expect(box).not.toBeChecked();
    await user.click(box);
    await waitFor(() => expect(mock.store.settings.agent.takeUnreviewed).toBe(true));
    await waitFor(() => expect(box).toBeChecked());
    await user.click(box);
    await waitFor(() => expect(mock.store.settings.agent.takeUnreviewed).toBe(false));
  });

  it("keeps site checks off until they are turned on, and says what they do", async () => {
    const { user, mock } = advanced();
    const box = await field(/Check recipes on live sites/);
    expect(box).not.toBeChecked();
    expect(screen.getByText("Weekly, read-only")).toBeInTheDocument();
    await user.click(box);
    await waitFor(() => expect(mock.store.settings.siteChecks.enabled).toBe(true));
    expect((await screen.findAllByText("Site checks turned on")).length).toBeGreaterThan(0);
  });

  it("shows the VPN warning only once a proxy address is entered", async () => {
    const { user } = advanced();
    const proxy = await field("Send visits through a proxy");
    expect(screen.queryByText(/does not make sites trust you more/)).toBeNull();
    await user.type(proxy, "http://10.0.0.100:8888");
    expect(await screen.findByText(/does not make sites trust you more/)).toBeVisible();
  });

  it("keeps the site checks description to one short line", async () => {
    advanced();
    await field(/Check recipes on live sites/);
    const description = screen.getByText("Weekly, read-only");
    expect((description.textContent ?? "").trim().split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it("describes each site being left alone in whole sentences, with its state as a word", async () => {
    advanced();
    const heading = await screen.findByRole("heading", { name: "Sites cooling down" });
    const region = within(heading.closest("section") as HTMLElement);
    expect(await region.findByText("Paused after 3 bot checks in a row.")).toBeVisible();
    expect(region.getByText(/Paused after repeated CAPTCHAs; next visit/)).toBeVisible();
    expect(region.getByText("Left alone after a rate limit.")).toBeVisible();
    expect(region.getByText("Paused")).toBeVisible();
    expect(region.getByText("Trying one visit")).toBeVisible();
    expect(region.getByText("Cooling down")).toBeVisible();
    expect(region.queryByText(/^Until /)).toBeNull();
  });

  it("saves only a changed schedule and confirms it", async () => {
    const { user, mock } = advanced();
    const poll = await field(/Check inbox every/);
    const save = screen.getByRole("button", { name: "Save schedule" });
    expect(save).toBeDisabled();
    await user.clear(poll);
    await user.type(poll, "30");
    await user.click(save);
    await waitFor(() => expect(mock.store.settings.schedule.pollMinutes).toBe(30));
    expect(mock.store.settings.schedule.noResponseDays).toBe(45);
    expect((await screen.findAllByText("Schedule saved")).length).toBeGreaterThan(0);
  });

  it("explains a value that is out of range and does not send it", async () => {
    const { user, mock } = advanced();
    const poll = await field(/Check inbox every/);
    await user.clear(poll);
    await user.type(poll, "5000");
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(await screen.findByText("Enter 1 to 1440.")).toBeVisible();
    expect(mock.store.settings.schedule.pollMinutes).toBe(15);
  });

  it("resets the form to what is saved", async () => {
    const { user } = advanced();
    const poll = await field(/Check inbox every/);
    await user.clear(poll);
    await user.type(poll, "99");
    const schedule = poll.closest("form") as HTMLFormElement;
    await user.click(within(schedule).getByRole("button", { name: "Reset to saved" }));
    expect(poll).toHaveValue(15);
  });

  it("saves a language model without echoing a key, and removes it after a confirmation", async () => {
    const { user, mock } = advanced();
    await user.type(await field("Base URL"), "http://localhost:11434/v1");
    await user.type(screen.getByLabelText("Model"), "llama3.1");
    await user.type(screen.getByLabelText(/API key/), "sk-test");
    await user.click(screen.getByRole("button", { name: "Save language model" }));
    await waitFor(() => expect(mock.store.settings.llm?.model).toBe("llama3.1"));
    expect(mock.store.settings.llm?.apiKeySet).toBe(true);
    expect(await screen.findByText("A key is saved. Leave this blank to keep it.")).toBeVisible();
    expect(screen.getByLabelText(/API key/)).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mock.store.settings.llm).toBeNull());
  });

  it("says the reply text goes to the language model address, and recommends a local one", async () => {
    advanced();
    expect(await screen.findByText(/Reply text goes to this URL/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "More about the language model" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More about the language model" })).toHaveAttribute(
      "aria-description",
      expect.stringMatching(/Prefer a local model/),
    );
  });

  it("rejects a language model address that is not a web address", async () => {
    const { user, mock } = advanced();
    await user.type(await field("Base URL"), "javascript:alert(1)");
    await user.type(screen.getByLabelText("Model"), "m");
    await user.click(screen.getByRole("button", { name: "Save language model" }));
    expect(await screen.findByText(/Enter a web address/)).toBeVisible();
    expect(mock.store.settings.llm).toBeNull();
  });

  it("lists the privacy laws by state", async () => {
    setup();
    expect(await screen.findByText("California")).toBeVisible();
    expect(screen.getByText("2 laws")).toBeVisible();
  });

  it("lists only states that have a law", async () => {
    const mock = createMockApp();
    const withoutLaws = { state: "AK" as const, statutes: [] };
    mock.handle = ((handle) => async (request: Parameters<typeof handle>[0]) => {
      const response = await handle(request);
      if (!request.url.endsWith("/settings/jurisdictions")) return response;
      const body = JSON.parse(response.body as string) as { jurisdictions: unknown[] };
      return {
        ...response,
        body: JSON.stringify({ jurisdictions: [...body.jurisdictions, withoutLaws] }),
      };
    })(mock.handle.bind(mock));
    setup(mock);
    await screen.findByText("California");
    expect(screen.queryByText("Alaska")).not.toBeInTheDocument();
    expect(screen.queryByText("0 laws")).not.toBeInTheDocument();
  });

  it("shows the retention windows and saves only the one that changed", async () => {
    const { user, mock } = advanced();
    const screenshots = await field("Keep screenshots for");
    expect(screenshots).toHaveValue("30");
    expect(screen.getByLabelText("Keep reply text for")).toHaveValue("forever");
    const save = screen.getByRole("button", { name: "Save retention" });
    expect(save).toBeDisabled();

    await user.selectOptions(screenshots, "7");
    await user.click(save);

    await waitFor(() => expect(mock.store.settings.retention.screenshotDays).toBe(7));
    expect(mock.store.settings.retention.messageDays).toBeNull();
    expect((await screen.findAllByText("Retention saved")).length).toBeGreaterThan(0);
    expect(await screen.findAllByText("Older data was cleared right away.")).not.toHaveLength(0);
  });

  it("does not claim anything was cleared when a window is made longer or switched off", async () => {
    const { user, mock } = advanced();
    await user.selectOptions(await field("Keep screenshots for"), "forever");
    await user.click(screen.getByRole("button", { name: "Save retention" }));
    await waitFor(() => expect(mock.store.settings.retention.screenshotDays).toBeNull());
    expect((await screen.findAllByText("Retention saved")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Older data was cleared right away.")).not.toBeInTheDocument();
  });

  it("can keep a window until the person deletes the data, and can turn one on", async () => {
    const { user, mock } = advanced();
    await user.selectOptions(await field("Keep screenshots for"), "forever");
    await user.selectOptions(screen.getByLabelText("Keep reply text for"), "90");
    await user.click(screen.getByRole("button", { name: "Save retention" }));
    await waitFor(() =>
      expect(mock.store.settings.retention).toEqual({ messageDays: 90, screenshotDays: null }),
    );
  });

  it("lists a saved window that is not one of the usual choices", async () => {
    const mock = createMockApp();
    mock.store.settings.retention = { messageDays: null, screenshotDays: 45 };
    advanced(mock);
    const screenshots = await field("Keep screenshots for");
    expect(screenshots).toHaveValue("45");
    expect(within(screenshots).getByRole("option", { name: "45 days" })).toBeInTheDocument();
  });

  it("puts the retention changes back with Reset", async () => {
    const { user } = advanced();
    const screenshots = await field("Keep screenshots for");
    await user.selectOptions(screenshots, "7");
    const form = screenshots.closest("form") as HTMLFormElement;
    await user.click(within(form).getByRole("button", { name: "Reset to saved" }));
    expect(screenshots).toHaveValue("30");
  });

  it("will not delete everything until the phrase is typed exactly", async () => {
    const { user, mock } = advanced();
    await user.click(await screen.findByRole("button", { name: "Delete all data" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete all data?" });
    const confirm = within(dialog).getByRole("button", { name: "Delete all data" });
    expect(confirm).toBeDisabled();

    const box = within(dialog).getByLabelText(/Type "delete everything" to confirm/);
    await user.type(box, "delete everythin");
    expect(confirm).toBeDisabled();
    await user.type(box, "g");
    expect(confirm).toBeEnabled();
    expect(mock.store.profiles.length).toBeGreaterThan(0);
  });

  it("deletes everything after the phrase, then leaves for an empty profiles page", async () => {
    const { user, mock } = advanced();
    mock.store.settings.llm = { baseUrl: "http://localhost:11434/v1", model: "m", apiKeySet: true };
    await user.click(await screen.findByRole("button", { name: "Delete all data" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete all data?" });
    await user.type(within(dialog).getByRole("textbox"), "delete everything");
    await user.click(within(dialog).getByRole("button", { name: "Delete all data" }));

    await waitFor(() => expect(mock.store.profiles).toEqual([]));
    expect(mock.store.requests).toEqual([]);
    expect(mock.store.settings.llm).toBeNull();
    expect((await screen.findAllByText("Everything was deleted")).length).toBeGreaterThan(0);
  });

  it("cancelling the reset dialog keeps the data and forgets what was typed", async () => {
    const { user, mock } = advanced();
    await user.click(await screen.findByRole("button", { name: "Delete all data" }));
    let dialog = await screen.findByRole("dialog", { name: "Delete all data?" });
    await user.type(within(dialog).getByRole("textbox"), "delete everything");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mock.store.profiles.length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Delete all data" }));
    dialog = await screen.findByRole("dialog", { name: "Delete all data?" });
    expect(within(dialog).getByRole("textbox")).toHaveValue("");
  });

  it("shows why a reset failed and keeps the dialog open", async () => {
    const mock = failing(/\/settings\/reset$/);
    const { user } = advanced(mock);
    await user.click(await screen.findByRole("button", { name: "Delete all data" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete all data?" });
    await user.type(within(dialog).getByRole("textbox"), "delete everything");
    await user.click(within(dialog).getByRole("button", { name: "Delete all data" }));
    expect(await within(dialog).findByText("Blocked for the test.")).toBeVisible();
    expect(dialog).toHaveAttribute("open");
  });

  it("keeps Save disabled until all three fields are filled", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /^Password/ }));
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    await user.type(await field("Current password"), "kickrocks-mock");
    await user.type(screen.getByLabelText("New password"), "a-long-enough-password");
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Repeat the new password"), "a-long-enough-password");
    expect(button).toBeEnabled();
  });

  it("catches a password mismatch before asking the server", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /^Password/ }));
    await user.type(await field("Current password"), "kickrocks-mock");
    await user.type(screen.getByLabelText("New password"), "a-long-enough-password");
    await user.type(screen.getByLabelText("Repeat the new password"), "something-different-here");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The two passwords do not match.")).toBeVisible();
  });

  it("changes the password and clears the form", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /^Password/ }));
    await user.type(await field("Current password"), "kickrocks-mock");
    await user.type(screen.getByLabelText("New password"), "a-long-enough-password");
    await user.type(screen.getByLabelText("Repeat the new password"), "a-long-enough-password");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findAllByText("Password changed")).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Current password")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Password/ }));
    expect(screen.getByLabelText("Current password")).toHaveValue("");
  });

  it("says when the settings cannot load", async () => {
    advanced(failing(/\/api\/settings$/));
    expect(await screen.findByText("Could not load settings")).toBeVisible();
  });
});

/** Agent access is one collapsed row, so a test of the token or the toggle opens it first. */
const openAccess = async (user: UserEvent) =>
  user.click(await screen.findByRole("button", { name: "Set up" }));

describe("agent settings", () => {
  it("shows the client config with a placeholder until a token exists", async () => {
    const { user } = setup();
    await openAccess(user);
    expect(await screen.findByText(/"mcpServers"/)).toBeVisible();
    expect(screen.getByText(/<your-token>/, { selector: "code" })).toBeVisible();
    expect(screen.getByText("Not created")).toBeVisible();
  });

  it("shows a new token once and puts it in the config", async () => {
    const { user, mock } = setup();
    await openAccess(user);
    await user.click(await screen.findByRole("button", { name: "Create a token" }));
    expect(await screen.findByText("Copy this token now")).toBeVisible();
    const token = mock.store.mcpToken ?? "";
    expect(token).toMatch(/^krmcp_/);
    expect(screen.getAllByText(token, { exact: false }).length).toBeGreaterThan(1);
    expect(screen.queryByText(/<your-token>/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create a new token" })).toBeVisible();
  });

  it("warns before replacing a token", async () => {
    const mock = createMockApp();
    mock.store.settings.mcp = { ...mock.store.settings.mcp, tokenSet: true };
    const { user } = setup(mock);
    await openAccess(user);
    await user.click(await screen.findByRole("button", { name: "Create a new token" }));
    const dialog = (await screen.findByText(/stops working at once/)).closest(
      "dialog",
    ) as HTMLElement;
    expect(within(dialog).getByText(/stops working at once/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mock.store.mcpToken).toBeNull();
  });

  it("turns agent access on", async () => {
    const { user, mock } = setup();
    await openAccess(user);
    await user.click(await screen.findByRole("checkbox", { name: /Allow agents to connect/ }));
    await waitFor(() => expect(mock.store.settings.mcp.enabled).toBe(true));
  });

  it("approves a proposed recipe after showing its steps", async () => {
    const { user, mock } = advanced();
    const locata = await screen.findByRole("region", { name: /Locata removal recipe/ });
    await user.click(within(locata).getByText("6 steps"));
    expect(within(locata).getByText(/Go to https:\/\/www\.locata\.example/)).toBeVisible();
    await user.click(within(locata).getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(mock.store.recipes.find((recipe) => recipe.targetId === "locata")?.status).toBe(
        "active",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: /Locata removal recipe/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it("rejects a recipe only after a confirmation", async () => {
    const { user, mock } = advanced();
    const kin = await screen.findByRole("region", { name: /KinSearch removal recipe/ });
    await user.click(within(kin).getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog");
    expect(mock.store.recipes.find((recipe) => recipe.targetId === "kinsearch")?.status).toBe(
      "pending_review",
    );
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(mock.store.recipes.find((recipe) => recipe.targetId === "kinsearch")?.status).toBe(
        "rejected",
      ),
    );
  });

  it("shows an empty state when nothing is proposed", async () => {
    const mock = createMockApp();
    mock.store.recipes = mock.store.recipes.filter((recipe) => recipe.status !== "pending_review");
    advanced(mock);
    expect(await screen.findByText("No proposed recipes")).toBeVisible();
  });

  it("says when the proposed recipes cannot load", async () => {
    advanced(failing(/\/api\/recipes/));
    expect(await screen.findByText("Could not load proposed recipes")).toBeVisible();
  });
});

describe("bundled recipes to check", () => {
  const statusOf = (mock: MockApp, targetId: string) =>
    mock.store.recipes.find((recipe) => recipe.targetId === targetId)?.status;

  it("lists shipped recipes that were not seen through, with what was and was not checked", async () => {
    advanced();
    expect(await screen.findByRole("heading", { name: /^Recipes to check/ })).toBeVisible();
    const cardinal = await screen.findByRole("region", {
      name: /Cardinal Insights removal recipe/,
    });
    expect(within(cardinal).getByText("Form read, but no real request sent.")).toBeVisible();
    expect(within(cardinal).getByText("What was and was not checked")).toBeInTheDocument();
    expect(
      within(cardinal).getByText(/Submission and the page after it were not exercised/),
    ).toBeInTheDocument();
    const blocked = screen.getByRole("region", { name: /Brightlist scan recipe/ });
    expect(within(blocked).getByText(/Bot protection hid the site/)).toBeVisible();
  });

  it("keeps an agent's proposals out of the bundled list", async () => {
    advanced();
    const heading = await screen.findByRole("heading", { name: /^Recipes to check/ });
    const bundledList = within(heading.closest("section") as HTMLElement);
    await bundledList.findByRole("region", { name: /Cardinal Insights removal recipe/ });
    expect(
      bundledList.queryByRole("region", { name: /Locata removal recipe/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps bundled recipes out of the agents' proposals", async () => {
    advanced();
    const heading = await screen.findByRole("heading", { name: /^Proposed recipes/ });
    const proposed = within(heading.closest("section") as HTMLElement);
    await proposed.findByRole("region", { name: /Locata removal recipe/ });
    expect(
      proposed.queryByRole("region", { name: /Cardinal Insights removal recipe/ }),
    ).not.toBeInTheDocument();
  });

  it("approves a recipe", async () => {
    const { user, mock } = advanced();
    const card = await screen.findByRole("region", { name: /Cardinal Insights removal recipe/ });
    await user.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(statusOf(mock, "cardinal-insights")).toBe("active"));
  });

  it("rejects only after a confirmation, then offers to approve it anyway", async () => {
    const { user, mock } = advanced();
    const card = await screen.findByRole("region", { name: /Brightlist scan recipe/ });
    await user.click(within(card).getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog");
    expect(statusOf(mock, "brightlist")).toBe("pending_review");
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(statusOf(mock, "brightlist")).toBe("rejected"));
    const rejected = await screen.findByRole("heading", { name: /^Rejected recipes/ });
    expect(rejected).toBeVisible();
    await user.click(await screen.findByRole("button", { name: "Approve anyway" }));
    await waitFor(() => expect(statusOf(mock, "brightlist")).toBe("active"));
  });

  it("says when every bundled recipe has been decided", async () => {
    const mock = createMockApp();
    mock.store.recipes = mock.store.recipes.filter(
      (recipe) => !(recipe.source === "bundled" && recipe.status === "pending_review"),
    );
    advanced(mock);
    expect(await screen.findByText("Nothing to check")).toBeVisible();
  });

  it("says when the bundled recipes cannot load", async () => {
    advanced(failing(/\/api\/recipes/));
    expect(await screen.findByText("Could not load bundled recipes")).toBeVisible();
  });
});

describe("the reply model card", () => {
  it("shows the model's state and that it only suggests", async () => {
    advanced();
    expect(await screen.findByText("Loaded, version v1")).toBeVisible();
    expect(screen.getByText("Suggestions only")).toBeVisible();
    expect(screen.queryByText(/Applies answers at/)).toBeNull();
    expect(screen.queryByText(/Spot checks/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply again" })).toBeNull();
  });

  it("lists how often the person agreed, by how sure the model was", async () => {
    advanced();
    expect(await screen.findByText("90% to 96%")).toBeVisible();
    expect(screen.getByText("21 of 22 agreed")).toBeVisible();
  });

  it("says when no model is installed", async () => {
    const mock = createMockApp();
    mock.store.settings.replyModel.status = {
      state: "not_installed",
      reason: null,
      version: null,
      threshold: null,
    };
    advanced(mock);
    expect(await screen.findByText("Not installed")).toBeVisible();
    expect(screen.getByText("Suggestions only")).toBeVisible();
  });

  it("offers the labelled replies for download", async () => {
    advanced();
    const link = await screen.findByRole("link", { name: "Download" });
    expect(link).toHaveAttribute("href", "/api/reply-model/labels");
  });
});
