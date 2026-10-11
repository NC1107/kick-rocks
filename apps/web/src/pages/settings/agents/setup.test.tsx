import { BENCH_NUM_CTX } from "@kickrocks/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentSetupName, applyAgentSetup } from "../../../../mock/agent-setup.js";
import { createMockApp } from "../../../../mock/app.js";
import { copyText } from "../../../lib/clipboard.js";
import { STORAGE_KEYS } from "../../../lib/storage.js";
import { renderPage } from "../../../test/render.js";
import { Component as AgentsPage } from "./index.js";

vi.mock("../../../lib/clipboard.js", () => ({ copyText: vi.fn(async () => true) }));

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEYS.agentsAdvancedOpen);
  vi.mocked(copyText).mockClear();
});

type Mock = ReturnType<typeof createMockApp>;

/** Renders the page against one of the mock setups, changed first by `tweak` so the page never sees the old one. */
function agents(setup: AgentSetupName = "gpu16", tweak: (mock: Mock) => void = () => undefined) {
  const mock = createMockApp();
  applyAgentSetup(mock.store, setup);
  tweak(mock);
  const page = renderPage(<AgentsPage />, {
    path: "/settings/agents",
    route: "/settings/agents",
    mock,
  });
  return { ...page, mock };
}

const SKELETON = "Looking for Ollama and the agent worker";
const ready = () =>
  waitFor(() => {
    expect(screen.queryByText(SKELETON)).toBeNull();
    expect(screen.getByRole("heading", { name: "Setup" })).toBeVisible();
  });
const recommended = async () =>
  within(
    (await screen.findByRole("heading", { name: "Recommended setup" })).closest(
      "section",
    ) as HTMLElement,
  );
const advanced = () => screen.getByRole("button", { name: /^Advanced/ });

function primaryButtons(): HTMLElement[] {
  return screen
    .queryAllByRole("button")
    .filter((button) => button.className.includes("bg-accent-fill"));
}

describe("while the setup is being checked", () => {
  it("shows a skeleton, then the page", async () => {
    agents();
    expect(screen.getByText(SKELETON)).toBeInTheDocument();
    await ready();
  });
});

describe("a 16 GB desktop with gpt-oss:20b installed and cleared", () => {
  it("detects the pieces and recommends one setup", async () => {
    agents();
    await ready();
    expect(await screen.findByText(/nick-desktop-agent, seen .*RTX 5080 15\.9 GB/)).toBeVisible();
    expect(
      screen.getByText(/desktop:11434, v0\.12\.3, 7 models, gpt-oss:20b loaded, 12\.7 GB on GPU/),
    ).toBeVisible();

    const card = await recommended();
    expect(card.getByText("Agent: gpt-oss:20b, 16k context")).toBeVisible();
    expect(card.getByText("Replies: gpt-oss:20b, same loaded copy")).toBeVisible();
    expect(
      card.getByText(
        "Your 16 GB card holds gpt-oss:20b, the only model with no safety mistake in the benchmark.",
      ),
    ).toBeVisible();
    expect(
      card.getByText(/Cleared here, so the agent worker may send forms on its own/),
    ).toBeVisible();
  });

  it("says the server and the worker probably reach one Ollama when their libraries match", async () => {
    agents();
    await ready();
    expect(await screen.findByText(/Probably the same server for both/)).toBeVisible();
    expect(screen.getByText("Ollama for replies and the agent")).toBeVisible();
    expect(screen.queryByText("Ollama for the agent (from the worker)")).toBeNull();
  });

  it("has exactly one primary action on the page", async () => {
    agents();
    await ready();
    await screen.findByRole("button", { name: "Apply" });
    expect(primaryButtons()).toHaveLength(1);
    expect(primaryButtons()[0]).toHaveTextContent("Apply");
  });

  it("applies the reply model and the agent model in one patch, then reads Applied", async () => {
    const { user, mock } = agents();
    await ready();
    const handle = vi.spyOn(mock, "handle");
    await user.click(await screen.findByRole("button", { name: "Apply" }));

    await waitFor(() => expect(mock.store.settings.agent.model).not.toBeNull());
    const patches = handle.mock.calls.filter(
      ([request]) => request.method === "PATCH" && request.url === "/api/settings",
    );
    expect(patches).toHaveLength(1);
    expect(JSON.parse(String(patches[0]?.[0].body))).toEqual({
      llm: { baseUrl: "http://desktop:11434/v1", model: "gpt-oss:20b" },
      agent: { model: { name: "gpt-oss:20b", thinking: "default", numCtx: BENCH_NUM_CTX } },
    });
    expect(mock.store.settings.llm?.model).toBe("gpt-oss:20b");
    const applied = await screen.findByRole("button", { name: "Applied" });
    expect(applied).toBeDisabled();
    expect(mock.store.settings.worker.model?.model?.name).toBe("gpt-oss:20b");
  });
});

describe("a 16 GB desktop whose best model has not passed the gate", () => {
  it("says each send waits, and the line opens the gate", async () => {
    const { user } = agents("gpu16-uncleared");
    await ready();
    const line = await screen.findByText(/Not cleared yet: each send waits for you in Review/);
    expect(advanced()).toHaveAttribute("aria-expanded", "false");
    await user.click(line);
    expect(advanced()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "Safety gate" })).toBeVisible();
  });

  it("allows a model without a pass only after a warning, and takes the allowance back", async () => {
    const { user, mock } = agents("gpu16-uncleared");
    await ready();
    await user.click(advanced());
    const overridden = () =>
      mock.store.settings.agent.gate.records.some(
        (record) => record.source === "override" && record.model.name === "gpt-oss:20b",
      );

    await user.click(await screen.findByRole("checkbox", { name: /Allow without a pass/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Nothing has shown this model is safe here/)).toBeVisible();
    expect(overridden()).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Allow it" }));
    await waitFor(() => expect(overridden()).toBe(true));
    expect(
      await screen.findByText(/Allowed by you, nothing has checked that it is safe/),
    ).toBeVisible();

    await user.click(screen.getByRole("checkbox", { name: /Allow without a pass/ }));
    await waitFor(() => expect(overridden()).toBe(false));
  });
});

describe("a small card", () => {
  it("asks once how much memory the GPU has, and saves the answer on the server", async () => {
    const { user, mock } = agents("small6");
    await ready();
    expect(await screen.findByText(/GPU not visible to the worker/)).toBeVisible();
    expect(
      screen.getByText("Could not tell how much memory the GPU running Ollama has"),
    ).toBeVisible();

    await user.click(screen.getByRole("radio", { name: "6" }));
    await waitFor(() =>
      expect(mock.store.settings.agent.gpuMemoryGb).toEqual({ worker: 6, server: 6 }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Could not tell how much memory the GPU running Ollama has"),
      ).toBeNull(),
    );
    expect(await (await recommended()).findByText("Replies: llama3.2:3b")).toBeVisible();
    expect(screen.getByText(/No local model this small drove a form well/)).toBeVisible();
    expect(localStorage.length).toBe(0);
  });

  it("does not ask again once it is answered", async () => {
    const mock = createMockApp();
    applyAgentSetup(mock.store, "small6");
    mock.store.settings.agent.gpuMemoryGb = { worker: 6, server: 6 };
    renderPage(<AgentsPage />, { path: "/settings/agents", route: "/settings/agents", mock });
    await (await recommended()).findByText("Replies: llama3.2:3b");
    expect(screen.queryByRole("radio", { name: "6" })).toBeNull();
  });
});

describe("when nothing is installed that fits", () => {
  it("gives the pull line to copy, and leaves Apply disabled", async () => {
    const { user } = agents("gpu16", ({ store }) => {
      for (const entry of Object.values(store.agentNetwork)) entry.models = [];
      const worker = store.settings.worker.model;
      if (worker?.ollama) worker.ollama = { ...worker.ollama, models: [] };
    });
    await ready();

    expect(await screen.findByText("No measured model is installed")).toBeVisible();
    expect((await recommended()).getByText("ollama pull gpt-oss:20b")).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Copy pull command" }));
    expect(copyText).toHaveBeenCalledWith("ollama pull gpt-oss:20b");
  });
});

describe("when no Ollama is found", () => {
  it("says so, and takes an address to check", async () => {
    const { user } = agents("none", ({ store }) => {
      store.agentNetwork["10.0.0.9:11434"] = {
        version: "0.12.3",
        models: [
          {
            name: "qwen3:8b",
            digest: "cc13a2d5b8f2",
            sizeBytes: 5_200_000_000,
            parameterSize: "8.2B",
            quantization: "Q4_K_M",
          },
        ],
        loaded: [],
      };
    });
    await ready();
    expect(await screen.findByText("Not found at the usual addresses")).toBeVisible();
    expect(screen.getByText("No agent worker has reported")).toBeVisible();
    expect(screen.getByRole("link", { name: /agents guide/ })).toHaveAttribute(
      "href",
      expect.stringContaining("docs/agents.md"),
    );

    await user.type(screen.getByLabelText("Ollama address"), "http://10.0.0.8:11434");
    await user.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("10.0.0.8:11434: nothing answered")).toBeVisible();

    await user.clear(screen.getByLabelText("Ollama address"));
    await user.type(screen.getByLabelText("Ollama address"), "http://10.0.0.9:11434");
    await user.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText(/10\.0\.0\.9:11434, v0\.12\.3, 1 model/)).toBeVisible();
    expect(
      await screen.findByText("Could not tell how much memory the GPU running Ollama has"),
    ).toBeVisible();
    await user.click(screen.getByRole("radio", { name: "8" }));
    expect(await (await recommended()).findByText("Replies: qwen3:8b")).toBeVisible();
  });
});

describe("an agent worker that cannot take a model from the server", () => {
  it("turns the action into copying its settings, and applies only the replies", async () => {
    const { user, mock } = agents("gpu16-old-worker");
    await ready();
    const copy = await screen.findByRole("button", { name: "Copy agent worker settings" });
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(primaryButtons()).toEqual([copy]);

    await user.click(copy);
    const copied = String(vi.mocked(copyText).mock.calls[0]?.[0]);
    expect(copied).toContain("KICKROCKS_AGENT_MODEL=gpt-oss:20b");
    expect(copied).toContain("KICKROCKS_AGENT_BASE_URL=http://localhost:11434");

    await user.click(screen.getByRole("button", { name: "Use for replies" }));
    await waitFor(() => expect(mock.store.settings.llm?.model).toBe("gpt-oss:20b"));
    expect(mock.store.settings.agent.model).toBeNull();
    expect(await screen.findByRole("button", { name: "Replies applied" })).toBeDisabled();
  });

  it("says so when no agent worker has reported at all", async () => {
    agents("gpu16", ({ store }) => {
      store.settings.worker.model = null;
    });
    await ready();
    expect(await screen.findByRole("button", { name: "Copy agent worker settings" })).toBeVisible();
    expect(screen.getByText(/No agent worker has reported yet/)).toBeVisible();
  });
});

describe("an agent worker that uses a hosted model", () => {
  it("makes no agent recommendation and offers none", async () => {
    agents("gpu16-hosted");
    await ready();
    expect(
      (await recommended()).getByText(
        "The agent worker uses anthropic, claude-sonnet-4-6; no local recommendation",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/^Agent: /)).toBeNull();
    expect(screen.queryByRole("radio", { name: "6" })).toBeNull();
  });
});

describe("the advanced part", () => {
  it("is collapsed, and holds the gate, the .env lines and the manual choice", async () => {
    const { user } = agents();
    await ready();
    expect(advanced()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("heading", { name: "Safety gate", hidden: true })).not.toBeVisible();
    expect(screen.getByText(/KICKROCKS_AGENT_MODEL=gpt-oss:20b/)).not.toBeVisible();

    await user.click(advanced());
    expect(advanced()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "Safety gate" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Choose the models by hand" })).toBeVisible();
    for (const line of [
      "KICKROCKS_AGENT_PROVIDER=ollama",
      "KICKROCKS_AGENT_MODEL=gpt-oss:20b",
      "KICKROCKS_AGENT_BASE_URL=http://localhost:11434",
      `KICKROCKS_AGENT_NUM_CTX=${BENCH_NUM_CTX}`,
    ]) {
      expect(screen.getByText(new RegExp(line))).toBeVisible();
    }
    expect(screen.queryByText(/KICKROCKS_AGENT_THINKING/)).toBeNull();
  });

  it("remembers whether it was open", async () => {
    const { user } = agents();
    await ready();
    await user.click(advanced());
    expect(localStorage.getItem(STORAGE_KEYS.agentsAdvancedOpen)).toBe("1");
  });

  it("starts open for a viewer who left it open", async () => {
    localStorage.setItem(STORAGE_KEYS.agentsAdvancedOpen, "1");
    agents();
    await ready();
    expect(advanced()).toHaveAttribute("aria-expanded", "true");
  });

  it("shows the gate state of every installed model off its real build", async () => {
    const { user } = agents("gpu16", ({ store }) => {
      store.settings.agent.gate.records = store.settings.agent.gate.records.map((record) =>
        record.model.name === "gpt-oss:20b"
          ? { ...record, model: { ...record.model, version: "an-older-build" } }
          : record,
      );
    });
    await ready();
    await user.click(advanced());
    const installed = within(
      (await screen.findByRole("heading", { name: /Installed models/ })).closest(
        "section",
      ) as HTMLElement,
    );
    expect(installed.getByText("gpt-oss:20b").closest("div")).toHaveTextContent("Pass out of date");
    expect(installed.getByText("qwen3:8b").closest("div")).toHaveTextContent("Not cleared");
  });

  it("chooses an agent model by hand, and goes back to the worker's own setting", async () => {
    const { user, mock } = agents();
    await ready();
    await user.click(advanced());
    const model = screen.getByRole("combobox", { name: "Agent model" });
    await user.selectOptions(model, "qwen3:14b");
    await user.click(screen.getByRole("button", { name: "Use this agent model" }));
    await waitFor(() => expect(mock.store.settings.agent.model?.name).toBe("qwen3:14b"));
    expect(mock.store.settings.agent.model?.thinking).toBe("off");

    await user.click(await screen.findByRole("button", { name: "Use the worker's own setting" }));
    await waitFor(() => expect(mock.store.settings.agent.model).toBeNull());
  });

  it("lets the person choose how long a held send waits, and lists what the gate cannot see", async () => {
    const { user, mock } = agents();
    await ready();
    await user.click(advanced());
    const hold = await screen.findByRole("combobox", { name: "Wait for me" });
    expect(hold).toHaveValue("10");
    await user.selectOptions(hold, "0");
    await waitFor(() => expect(mock.store.settings.agent.approvalHoldMinutes).toBe(0));
    const limits = within(
      screen
        .getByRole("heading", { name: "What the gate cannot see" })
        .closest("section") as HTMLElement,
    );
    expect(limits.getByText(/Sites that need a live connection\./)).toBeVisible();
  });

  it("lists what is cleared and lets an override be removed there", async () => {
    const { user, mock } = agents();
    await ready();
    await user.click(advanced());
    const cleared = within(
      (await screen.findByRole("heading", { name: /Cleared models/ })).closest(
        "section",
      ) as HTMLElement,
    );
    expect(cleared.getByText(/Passed 40 runs/)).toBeVisible();
    await user.click(cleared.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(mock.store.settings.agent.gate.records.map((record) => record.source)).toEqual([
        "bench",
      ]),
    );
  });

  it("lists every address tried, and rechecks on request", async () => {
    const { user } = agents("none");
    await ready();
    await user.click(advanced());
    const details = within(
      (await screen.findByRole("heading", { name: "Detection details" })).closest(
        "section",
      ) as HTMLElement,
    );
    for (const address of [
      "127.0.0.1:11434",
      "host.docker.internal:11434",
      "172.17.0.1:11434",
      "ollama:11434",
    ]) {
      expect(details.getByText(address)).toBeVisible();
    }
    expect(details.getAllByText("nothing answered")).toHaveLength(4);
    await user.click(details.getByRole("button", { name: "Recheck" }));
  });
});

describe("agent access", () => {
  it("is one collapsed row until the person sets it up", async () => {
    const { user } = agents();
    await ready();
    const section = within(
      screen.getByRole("heading", { name: "Agent access" }).closest("section") as HTMLElement,
    );
    expect(section.getByText("Off")).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: /Allow agents to connect/ })).toBeNull();
    await user.click(section.getByRole("button", { name: "Set up" }));
    expect(await screen.findByRole("checkbox", { name: /Allow agents to connect/ })).toBeVisible();
  });

  it("says when it is on and a token is set", async () => {
    const mock = createMockApp();
    mock.store.settings.mcp = { ...mock.store.settings.mcp, enabled: true, tokenSet: true };
    renderPage(<AgentsPage />, { path: "/settings/agents", route: "/settings/agents", mock });
    expect(await screen.findByText("On, token set")).toBeVisible();
  });
});
