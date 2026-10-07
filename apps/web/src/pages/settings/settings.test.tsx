import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { Component as AgentsPage } from "./agents/index.js";
import { Component as SettingsPage } from "./index.js";

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

const field = (label: RegExp | string) => screen.findByLabelText(label);

describe("general settings", () => {
  it("shows the saved schedule and the worker's state", async () => {
    general();
    expect(await field(/Check the inbox every/)).toHaveValue(15);
    expect(screen.getByLabelText(/Follow up at most/)).toHaveValue(2);
    expect(await screen.findByText("Worker")).toBeVisible();
    expect(screen.getByText("worker-home")).toBeVisible();
  });

  it("saves only a changed schedule and confirms it", async () => {
    const { user, mock } = general();
    const poll = await field(/Check the inbox every/);
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
    const poll = await field(/Check the inbox every/);
    await user.clear(poll);
    await user.type(poll, "5000");
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(await screen.findByText("Enter 1 to 1440.")).toBeVisible();
    expect(mock.store.settings.schedule.pollMinutes).toBe(15);
  });

  it("resets the form to what is saved", async () => {
    const { user } = general();
    const poll = await field(/Check the inbox every/);
    await user.clear(poll);
    await user.type(poll, "99");
    await user.click(screen.getByRole("button", { name: "Reset" }));
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
    mock.store.settings.worker = { enabled: false, status: null };
    general(mock);
    expect(await screen.findByText("The worker is switched off")).toBeVisible();
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
    expect(
      screen.getByText(/the other states, requests cite the company's own privacy policy/),
    ).toBeVisible();
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
  it("shows the command with a placeholder until a token exists", async () => {
    agents();
    expect(await screen.findByText(/claude mcp add --transport http kickrocks/)).toBeVisible();
    expect(screen.getByText(/<your-token>/, { selector: "code" })).toBeVisible();
    expect(screen.getByText("Not created")).toBeVisible();
  });

  it("shows a new token once and puts it in the command", async () => {
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
