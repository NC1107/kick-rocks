import { BENCH_NUM_CTX } from "@kickrocks/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentSetupName, applyAgentSetup } from "../../../../mock/agent-setup.js";
import { createMockApp } from "../../../../mock/app.js";
import { copyText } from "../../../lib/clipboard.js";
import { STORAGE_KEYS } from "../../../lib/storage.js";
import { renderPage } from "../../../test/render.js";
import { AgentTuning } from "../advanced/AgentTuning.js";

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
  const page = renderPage(<AgentTuning />, { path: "/settings", route: "/settings", mock });
  return { ...page, mock };
}

const SKELETON = "Looking for Ollama and the agent worker";
const ready = () =>
  waitFor(() => {
    expect(screen.queryByText(SKELETON)).toBeNull();
    expect(screen.getByRole("button", { name: /^Agent tuning/ })).toBeVisible();
  });
const recommended = async () =>
  within(
    (await screen.findByRole("heading", { name: "Recommended setup" })).closest(
      "section",
    ) as HTMLElement,
  );
const advanced = () => screen.getByRole("button", { name: /^Agent tuning/ });

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
  it("recommends one setup", async () => {
    agents();
    await ready();

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
    expect(
      await screen.findByText("Could not tell how much memory the GPU running Ollama has"),
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
    renderPage(<AgentTuning />, { path: "/settings", route: "/settings", mock });
    await (await recommended()).findByText("Replies: llama3.2:3b");
    expect(screen.queryByRole("radio", { name: "6" })).toBeNull();
  });
});

describe("an answered GPU question", () => {
  it("shows the answer and lets the person change it", async () => {
    const { user, mock } = agents("small6", ({ store }) => {
      store.settings.agent.gpuMemoryGb = { worker: 6, server: 6 };
    });
    await ready();
    expect(await screen.findByText("6 GB, from your answer")).toBeVisible();
    expect(screen.queryByRole("radio", { name: "8" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.click(screen.getByRole("radio", { name: "8" }));
    await waitFor(() =>
      expect(mock.store.settings.agent.gpuMemoryGb).toEqual({ worker: 8, server: 8 }),
    );
    expect(await screen.findByText("8 GB, from your answer")).toBeVisible();
  });

  it("is not shown when the GPU was read from the machine", async () => {
    agents("gpu16");
    await ready();
    expect(screen.queryByText(/from your answer/)).toBeNull();
  });
});

describe("when the agent worker cannot reach its own Ollama", () => {
  it("says so instead of saying it cannot take a model", async () => {
    agents("gpu16", ({ store }) => {
      const worker = store.settings.worker.model;
      if (worker?.ollama) {
        worker.ollama = { ...worker.ollama, reachable: false, error: "unreachable", models: [] };
      }
    });
    await ready();
    expect(await screen.findByText(/cannot reach its Ollama at/)).toBeVisible();
    expect(screen.queryByText(/cannot take a model from here/)).toBeNull();
  });
});

describe("when the setup check fails or is slow", () => {
  const SETUP_PATH = "/api/settings/agent-setup";

  function withSetup(answer: () => Promise<Response | never>) {
    return (mock: Mock) => {
      const handle = mock.handle.bind(mock);
      mock.handle = async (request) =>
        request.url.startsWith(SETUP_PATH) ? ((await answer()) as never) : handle(request);
    };
  }
  const failing = async () => ({
    status: 500,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: { code: "internal", message: "The check failed." } }),
  });

  it("keeps the safety gate reachable after an error", async () => {
    const { user } = agents("gpu16", withSetup(failing as never));
    expect(await screen.findByText("Could not check the setup")).toBeVisible();
    await user.click(advanced());
    expect(await screen.findByRole("heading", { name: "When a send is held" })).toBeVisible();
  });

  it("keeps the safety gate reachable while detection is still running", async () => {
    agents(
      "gpu16",
      withSetup(() => new Promise(() => undefined)),
    );
    expect(await screen.findByText(SKELETON)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /^Agent tuning/ })).toBeVisible();
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
        "The agent worker uses openai, gpt-5-mini; no local recommendation",
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
      "KICKROCKS_AGENT_WORKER_ID=agent-worker",
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
