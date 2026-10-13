import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type AgentSetupName, applyAgentSetup } from "../../../../mock/agent-setup.js";
import { applyAgentPreset } from "../../../../mock/agents.js";
import { createMockApp } from "../../../../mock/app.js";
import { copyText } from "../../../lib/clipboard.js";
import { renderPage } from "../../../test/render.js";
import { Component as AdvancedPage } from "../advanced/index.js";
import { Component as SetupPage } from "../index.js";

vi.mock("../../../lib/clipboard.js", () => ({ copyText: vi.fn(async () => true) }));

type Mock = ReturnType<typeof createMockApp>;

function setup(name: AgentSetupName, tweak: (mock: Mock) => void = () => undefined) {
  const mock = createMockApp();
  applyAgentSetup(mock.store, name);
  tweak(mock);
  const page = renderPage(<SetupPage />, { path: "/settings", route: "/settings", mock });
  return { ...page, mock };
}

const helper = async (name: string) => within(await screen.findByRole("group", { name }));

describe("the helpers with nothing set up", () => {
  it("shows each helper with its state word and one action", async () => {
    setup("empty");
    const browser = await helper("Browser worker");
    expect(browser.getByText("Not found")).toBeVisible();
    expect(browser.getByRole("button", { name: "Show command" })).toBeVisible();
    const agent = await helper("Agent worker");
    expect(agent.getByText("Not found")).toBeVisible();
    expect(agent.getByRole("button", { name: "Show command" })).toBeVisible();
    const access = await helper("Agent access (MCP)");
    expect(access.getByText("Off")).toBeVisible();
    expect(access.getByRole("button", { name: "Set up" })).toBeVisible();
    const reply = await helper("Reply model");
    expect(await reply.findByText("Not found")).toBeVisible();
    expect(reply.getByRole("button", { name: "Check" })).toBeVisible();
    const model = await helper("Agent model");
    expect(await model.findByText("Waiting")).toBeVisible();
    expect(model.getByRole("button", { name: "Check" })).toBeVisible();
  });

  it("says nothing is connected instead of listing an empty group", async () => {
    setup("empty");
    expect(await screen.findByText("None connected")).toBeVisible();
    expect(screen.queryByRole("heading", { name: /^Connected agents/ })).toBeNull();
  });

  it("keeps the two Ollama addresses in separate fields", async () => {
    setup("empty");
    const reply = (await helper("Reply model")).getByRole("textbox", {
      name: "Reply model address",
    });
    const agent = (await helper("Agent model")).getByRole("textbox", {
      name: "Agent model address",
    });
    expect(reply).not.toBe(agent);
    expect(screen.queryByLabelText("Ollama address")).toBeNull();
  });

  it("leaves out the addresses tried, the guide sentence and the old boxes", async () => {
    setup("empty");
    await helper("Reply model");
    expect(screen.queryByText(/^Tried /)).toBeNull();
    expect(screen.queryByText(/Ollama steps are in the/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Advanced/ })).toBeNull();
    expect(screen.queryByText(/Seen in the last 7 days/)).toBeNull();
  });
});

describe("the helpers when everything is running", () => {
  it("reads ok on every row", async () => {
    setup("ready");
    expect(await (await helper("Browser worker")).findByText("Online")).toBeVisible();
    expect((await helper("Agent worker")).getByText("Online")).toBeVisible();
    expect((await helper("Agent access (MCP)")).getByText("On")).toBeVisible();
    expect(await (await helper("Reply model")).findByText("Found")).toBeVisible();
    expect(await (await helper("Agent model")).findByText("Found")).toBeVisible();
  });

  it("offers no command for a worker that is already online", async () => {
    setup("ready");
    const browser = await helper("Browser worker");
    await browser.findByText("Online");
    expect(browser.queryByRole("button", { name: "Show command" })).toBeNull();
  });

  it("lists the connected agents under the helpers, with their count", async () => {
    setup("ready", (mock) => applyAgentPreset(mock.store, "several"));
    expect(await screen.findByRole("heading", { name: "Connected agents · 4" })).toBeVisible();
    expect(screen.queryByText("None connected")).toBeNull();
  });

  it("marks a worker that stopped calling in as offline", async () => {
    setup("ready", (mock) => {
      const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const builtin = mock.store.settings.worker.builtin;
      if (builtin) mock.store.settings.worker.builtin = { ...builtin, lastSeenAt: old };
    });
    expect(await (await helper("Browser worker")).findByText("Offline")).toBeVisible();
  });

  it("says the workers are off when the server has none enabled", async () => {
    setup("empty", (mock) => {
      mock.store.settings.worker = { enabled: false, builtin: null, model: null };
    });
    expect((await helper("Browser worker")).getByText("Off")).toBeVisible();
  });
});

describe("the start command", () => {
  it("shows the command with a copy button, and flips to ok once the worker calls in", async () => {
    const { user, mock } = setup("empty");
    const browser = await helper("Browser worker");
    await user.click(browser.getByRole("button", { name: "Show command" }));
    expect(browser.getByText("docker compose --profile worker up -d worker")).toBeVisible();
    expect(browser.getByText("waiting for heartbeat...")).toBeVisible();

    await user.click(browser.getByRole("button", { name: "Copy command" }));
    expect(copyText).toHaveBeenCalledWith("docker compose --profile worker up -d worker");

    mock.store.settings.worker.builtin = {
      workerId: "worker-home",
      version: "0.1.0",
      lastSeenAt: new Date().toISOString(),
      busy: false,
      currentTaskId: null,
    };
    expect(await browser.findByText("Heartbeat received", {}, { timeout: 9000 })).toBeVisible();
    expect(browser.getByText("Online")).toBeVisible();
  }, 20_000);

  it("gives the agent worker its own command", async () => {
    const { user } = setup("empty");
    const agent = await helper("Agent worker");
    await user.click(agent.getByRole("button", { name: "Show command" }));
    expect(agent.getByText("docker compose --profile agent up -d agent-worker")).toBeVisible();
  });
});

describe("the model rows", () => {
  it("checks the typed address on its own row and shows what answered", async () => {
    const { user } = setup("ready");
    const model = await helper("Agent model");
    await model.findByText("Found");
    await user.type(
      model.getByRole("textbox", { name: "Agent model address" }),
      "http://nowhere:1",
    );
    await user.click(model.getByRole("button", { name: "Check" }));
    expect(await model.findByText("Not found")).toBeVisible();
    expect(model.getByText(/nowhere:1/)).toBeVisible();
    expect((await helper("Reply model")).getByText("Found")).toBeVisible();
  });

  it("says which helper uses each address", async () => {
    setup("ready");
    expect((await helper("Reply model")).getByText("Used for reply suggestions")).toBeVisible();
    expect((await helper("Agent model")).getByText("Used by the agent worker")).toBeVisible();
  });
});

describe("agent access", () => {
  it("opens the token dialog from the Set up action", async () => {
    const { user } = setup("empty");
    await user.click((await helper("Agent access (MCP)")).getByRole("button", { name: "Set up" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Create a token" })).toBeVisible();
  });
});

describe("the split between Setup and Advanced", () => {
  const headings = () =>
    screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent ?? "");

  it("renders every settings section exactly once across the two pages", async () => {
    const mock = createMockApp();
    const first = renderPage(<SetupPage />, { path: "/settings", route: "/settings", mock });
    await screen.findByRole("heading", { name: "Helpers" });
    await screen.findByRole("heading", { name: /^Privacy laws/ });
    const onSetup = headings();
    first.unmount();

    renderPage(<AdvancedPage />, {
      path: "/settings/advanced",
      route: "/settings/advanced",
      mock,
    });
    await screen.findByRole("heading", { name: "Danger zone" });
    const onAdvanced = headings();

    const setupNames = ["Password", "Mailbox", "Privacy laws", "Helpers"];
    const advancedNames = [
      "Schedule",
      "Site checks",
      "Pace and route",
      "Sites cooling down",
      "Retention",
      "Recipes to check",
      "Proposed recipes",
      "Agent worker",
      "Reply classifier",
      "Language model",
      "Danger zone",
    ];
    for (const name of setupNames) {
      expect(onSetup.filter((text) => text.startsWith(name))).toHaveLength(1);
    }
    for (const name of advancedNames) {
      expect(onAdvanced.filter((text) => text.startsWith(name))).toHaveLength(1);
    }
    const all = [...onSetup, ...onAdvanced];
    expect(new Set(all).size).toBe(all.length);
    for (const name of advancedNames) {
      expect(onSetup.some((text) => text.startsWith(name))).toBe(false);
    }
    for (const name of setupNames) {
      expect(onAdvanced.some((text) => text.startsWith(name))).toBe(false);
    }
  });

  it("drops the on-this-page strip", async () => {
    setup("empty");
    await screen.findByRole("heading", { name: "Helpers" });
    expect(screen.queryByRole("navigation", { name: "On this page" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Jump to a section" })).toBeNull();
  });

  it("links the Sites tab to the broker catalogue", async () => {
    setup("empty");
    await screen.findByRole("heading", { name: "Helpers" });
    expect(screen.getByRole("link", { name: "Sites" })).toHaveAttribute("href", "/targets");
    expect(screen.getByRole("link", { name: "Setup" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "Advanced" })).toHaveAttribute(
      "href",
      "/settings/advanced",
    );
    await waitFor(() => expect(screen.queryByText("Loading helpers")).toBeNull());
  });
});
