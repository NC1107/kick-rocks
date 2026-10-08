import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { Component as AgentsPage } from "./agents/index.js";
import { Component as SettingsPage } from "./index.js";
import { Component as RecipesPage } from "./recipes/index.js";

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

const general = (mock = createMockApp()) =>
  renderPage(<SettingsPage />, { path: "/settings", route: "/settings", mock });
const agents = (mock = createMockApp()) =>
  renderPage(<AgentsPage />, { path: "/settings/agents", route: "/settings/agents", mock });

const bundled = (mock = createMockApp()) =>
  renderPage(<RecipesPage />, { path: "/settings/recipes", route: "/settings/recipes", mock });

const AGENT_WORKER = {
  workerId: "agent-home",
  version: "agent-0.1.0",
  lastSeenAt: new Date().toISOString(),
  busy: true,
  currentTaskId: null,
};

const field = (label: RegExp | string) => screen.findByLabelText(label);

describe("general settings", () => {
  it("shows the saved schedule and the worker's state", async () => {
    const mock = createMockApp();
    mock.store.settings.worker.model = AGENT_WORKER;
    general(mock);
    expect(await field(/Check inbox every/)).toHaveValue(15);
    expect(screen.getByLabelText(/Follow-ups/)).toHaveValue(2);
    expect(await screen.findByText("Recipe worker")).toBeVisible();
    expect(screen.getByText("worker-home")).toBeVisible();
    expect(screen.getByText("agent-home")).toBeVisible();
  });

  it("shows each worker's own state, so a down agent worker is not hidden by a live recipe worker", async () => {
    const mock = createMockApp();
    mock.store.settings.worker.model = {
      ...AGENT_WORKER,
      lastSeenAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    };
    general(mock);
    const recipe = await screen.findByRole("region", { name: "Recipe worker" });
    const agent = screen.getByRole("region", { name: "Agent worker" });
    expect(within(recipe).getByText("Worker online")).toBeVisible();
    expect(within(agent).getByText("Worker offline")).toBeVisible();
    expect(within(agent).queryByText("Doing")).toBeNull();
  });

  it("lets the person allow the agent worker onto unreviewed sites, and take it back", async () => {
    const { user, mock } = general();
    const box = await screen.findByRole("checkbox", {
      name: /Let the agent worker take unreviewed targets/,
    });
    expect(box).not.toBeChecked();
    await user.click(box);
    await waitFor(() => expect(mock.store.settings.agent.takeUnreviewed).toBe(true));
    await waitFor(() => expect(box).toBeChecked());
    await user.click(box);
    await waitFor(() => expect(mock.store.settings.agent.takeUnreviewed).toBe(false));
  });

  it("keeps site checks off until they are turned on, and says what they do", async () => {
    const { user, mock } = general();
    const box = await field(/Check recipe pages on the real broker sites/);
    expect(box).not.toBeChecked();
    expect(screen.getByText(/never submits a removal/)).toBeInTheDocument();
    await user.click(box);
    await waitFor(() => expect(mock.store.settings.siteChecks.enabled).toBe(true));
    expect((await screen.findAllByText("Site checks turned on")).length).toBeGreaterThan(0);
  });

  it("saves only a changed schedule and confirms it", async () => {
    const { user, mock } = general();
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
    const { user, mock } = general();
    const poll = await field(/Check inbox every/);
    await user.clear(poll);
    await user.type(poll, "5000");
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(await screen.findByText("Enter 1 to 1440.")).toBeVisible();
    expect(mock.store.settings.schedule.pollMinutes).toBe(15);
  });

  it("resets the form to what is saved", async () => {
    const { user } = general();
    const poll = await field(/Check inbox every/);
    await user.clear(poll);
    await user.type(poll, "99");
    const schedule = poll.closest("form") as HTMLFormElement;
    await user.click(within(schedule).getByRole("button", { name: "Reset" }));
    expect(poll).toHaveValue(15);
  });

  it("saves a language model without echoing a key, and removes it after a confirmation", async () => {
    const { user, mock } = general();
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

  it("rejects a language model address that is not a web address", async () => {
    const { user, mock } = general();
    await user.type(await field("Base URL"), "javascript:alert(1)");
    await user.type(screen.getByLabelText("Model"), "m");
    await user.click(screen.getByRole("button", { name: "Save language model" }));
    expect(await screen.findByText(/Enter a web address/)).toBeVisible();
    expect(mock.store.settings.llm).toBeNull();
  });

  it("says when the worker is switched off", async () => {
    const mock = createMockApp();
    mock.store.settings.worker = { enabled: false, builtin: null, model: null };
    general(mock);
    expect(await screen.findByText("The workers are switched off")).toBeVisible();
  });

  it("lists the privacy laws by state", async () => {
    general();
    expect(await screen.findByText("California")).toBeVisible();
    expect(screen.getByText("2 laws")).toBeVisible();
  });

  it("lists only states that have a law, with one line for the rest", async () => {
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
    general(mock);
    await screen.findByText("California");
    expect(screen.queryByText("Alaska")).not.toBeInTheDocument();
    expect(screen.queryByText("0 laws")).not.toBeInTheDocument();
    expect(screen.getByText(/have no law on file/)).toBeVisible();
  });

  it("shows the retention windows and saves only the one that changed", async () => {
    const { user, mock } = general();
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
    const { user, mock } = general();
    await user.selectOptions(await field("Keep screenshots for"), "forever");
    await user.click(screen.getByRole("button", { name: "Save retention" }));
    await waitFor(() => expect(mock.store.settings.retention.screenshotDays).toBeNull());
    expect((await screen.findAllByText("Retention saved")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Older data was cleared right away.")).not.toBeInTheDocument();
  });

  it("can keep a window until the person deletes the data, and can turn one on", async () => {
    const { user, mock } = general();
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
    general(mock);
    const screenshots = await field("Keep screenshots for");
    expect(screenshots).toHaveValue("45");
    expect(within(screenshots).getByRole("option", { name: "45 days" })).toBeInTheDocument();
  });

  it("puts the retention changes back with Reset", async () => {
    const { user } = general();
    const screenshots = await field("Keep screenshots for");
    await user.selectOptions(screenshots, "7");
    const form = screenshots.closest("form") as HTMLFormElement;
    await user.click(within(form).getByRole("button", { name: "Reset" }));
    expect(screenshots).toHaveValue("30");
  });

  it("will not delete everything until the phrase is typed exactly", async () => {
    const { user, mock } = general();
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
    const { user, mock } = general();
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
    const { user, mock } = general();
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
    const { user } = general(mock);
    await user.click(await screen.findByRole("button", { name: "Delete all data" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete all data?" });
    await user.type(within(dialog).getByRole("textbox"), "delete everything");
    await user.click(within(dialog).getByRole("button", { name: "Delete all data" }));
    expect(await within(dialog).findByText("Blocked for the test.")).toBeVisible();
    expect(dialog).toHaveAttribute("open");
  });

  it("keeps Change password disabled until all three fields are filled", async () => {
    const { user } = general();
    const button = await screen.findByRole("button", { name: "Change password" });
    expect(button).toBeDisabled();
    await user.type(await field("Current password"), "kickrocks-mock");
    await user.type(screen.getByLabelText("New password"), "a-long-enough-password");
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Repeat the new password"), "a-long-enough-password");
    expect(button).toBeEnabled();
  });

  it("catches a password mismatch before asking the server", async () => {
    const { user } = general();
    await user.type(await field("Current password"), "kickrocks-mock");
    await user.type(screen.getByLabelText("New password"), "a-long-enough-password");
    await user.type(screen.getByLabelText("Repeat the new password"), "something-different-here");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("The two passwords do not match.")).toBeVisible();
  });

  it("changes the password and clears the form", async () => {
    const { user } = general();
    await user.type(await field("Current password"), "kickrocks-mock");
    await user.type(screen.getByLabelText("New password"), "a-long-enough-password");
    await user.type(screen.getByLabelText("Repeat the new password"), "a-long-enough-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect((await screen.findAllByText("Password changed")).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Current password")).toHaveValue("");
  });

  it("says when the settings cannot load", async () => {
    general(failing(/\/api\/settings$/));
    expect(await screen.findByText("Could not load settings")).toBeVisible();
  });
});

describe("agent settings", () => {
  it("shows the client config with a placeholder until a token exists", async () => {
    agents();
    expect(await screen.findByText(/"mcpServers"/)).toBeVisible();
    expect(screen.getByText(/<your-token>/, { selector: "code" })).toBeVisible();
    expect(screen.getByText("Not created")).toBeVisible();
  });

  it("shows a new token once and puts it in the config", async () => {
    const { user, mock } = agents();
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
    const { user } = agents(mock);
    await user.click(await screen.findByRole("button", { name: "Create a new token" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/stops working at once/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mock.store.mcpToken).toBeNull();
  });

  it("turns agent access on", async () => {
    const { user, mock } = agents();
    await user.click(await screen.findByRole("checkbox", { name: /Allow agents to connect/ }));
    await waitFor(() => expect(mock.store.settings.mcp.enabled).toBe(true));
  });

  it("approves a proposed recipe after showing its steps", async () => {
    const { user, mock } = agents();
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
    const { user, mock } = agents();
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
    agents(mock);
    expect(await screen.findByText("No proposed recipes")).toBeVisible();
  });

  it("says when the proposed recipes cannot load", async () => {
    agents(failing(/\/api\/recipes/));
    expect(await screen.findByText("Could not load proposed recipes")).toBeVisible();
  });
});

describe("bundled recipes to check", () => {
  const statusOf = (mock: MockApp, targetId: string) =>
    mock.store.recipes.find((recipe) => recipe.targetId === targetId)?.status;

  it("lists shipped recipes that were not seen through, with what was and was not checked", async () => {
    bundled();
    expect(await screen.findByRole("heading", { name: /^Bundled recipes to check/ })).toBeVisible();
    const cardinal = await screen.findByRole("region", {
      name: /Cardinal Insights removal recipe/,
    });
    expect(
      within(cardinal).getByText("The form was read but no real request was ever sent through it."),
    ).toBeVisible();
    expect(within(cardinal).getByText("What was and was not checked")).toBeVisible();
    expect(
      within(cardinal).getByText(/Submission and the page after it were not exercised/),
    ).toBeVisible();
    const blocked = screen.getByRole("region", { name: /Brightlist scan recipe/ });
    expect(within(blocked).getByText(/Bot protection hid the site/)).toBeVisible();
  });

  it("keeps an agent's proposals out of the bundled list", async () => {
    bundled();
    await screen.findByRole("region", { name: /Cardinal Insights removal recipe/ });
    expect(screen.queryByRole("region", { name: /Locata removal recipe/ })).not.toBeInTheDocument();
  });

  it("keeps bundled recipes out of the agents' proposals", async () => {
    agents();
    await screen.findByRole("region", { name: /Locata removal recipe/ });
    expect(
      screen.queryByRole("region", { name: /Cardinal Insights removal recipe/ }),
    ).not.toBeInTheDocument();
  });

  it("approves a recipe", async () => {
    const { user, mock } = bundled();
    const card = await screen.findByRole("region", { name: /Cardinal Insights removal recipe/ });
    await user.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(statusOf(mock, "cardinal-insights")).toBe("active"));
  });

  it("rejects only after a confirmation, then offers to approve it anyway", async () => {
    const { user, mock } = bundled();
    const card = await screen.findByRole("region", { name: /Brightlist scan recipe/ });
    await user.click(within(card).getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog");
    expect(statusOf(mock, "brightlist")).toBe("pending_review");
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(statusOf(mock, "brightlist")).toBe("rejected"));
    const rejected = await screen.findByRole("heading", { name: /^Rejected bundled recipes/ });
    expect(rejected).toBeVisible();
    await user.click(await screen.findByRole("button", { name: "Approve anyway" }));
    await waitFor(() => expect(statusOf(mock, "brightlist")).toBe("active"));
  });

  it("says when every bundled recipe has been decided", async () => {
    const mock = createMockApp();
    mock.store.recipes = mock.store.recipes.filter(
      (recipe) => !(recipe.source === "bundled" && recipe.status === "pending_review"),
    );
    bundled(mock);
    expect(await screen.findByText("Nothing to check")).toBeVisible();
  });

  it("says when the bundled recipes cannot load", async () => {
    bundled(failing(/\/api\/recipes/));
    expect(await screen.findByText("Could not load bundled recipes")).toBeVisible();
  });
});
