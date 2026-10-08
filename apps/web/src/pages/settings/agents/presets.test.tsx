import { BENCH_NUM_CTX } from "@kickrocks/shared";
import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createMockApp } from "../../../../mock/app.js";
import { STORAGE_KEYS } from "../../../lib/storage.js";
import { renderPage } from "../../../test/render.js";
import { Component as AgentsPage } from "./index.js";

beforeEach(() => localStorage.removeItem(STORAGE_KEYS.gpuSize));

const agents = (mock = createMockApp()) =>
  renderPage(<AgentsPage />, { path: "/settings/agents", route: "/settings/agents", mock });

const pickGpu = async (user: UserEvent, label: string) => {
  await user.selectOptions(await screen.findByLabelText("GPU memory"), label);
};

const group = (name: string) => screen.getByRole("heading", { name, level: 3 }).closest("section");

describe("the model presets", () => {
  it("opens on 16 GB with the model the guide recommends and what to expect from it", async () => {
    agents();
    expect(await screen.findByLabelText("GPU memory")).toHaveValue("16");
    const agent = within(group("Agent model") as HTMLElement);
    expect(agent.getByText("gpt-oss:20b")).toBeVisible();
    expect(agent.getByText("27 of 36 runs")).toBeVisible();
    expect(agent.getByText(/no safety mistake in any benchmark run/)).toBeVisible();
    const reply = within(group("Reply model") as HTMLElement);
    expect(reply.getByText("gpt-oss:20b")).toBeVisible();
    expect(reply.getByText("94.2%")).toBeVisible();
  });

  it("gives the agent worker's provider settings to copy", async () => {
    agents();
    const settings = within(
      (await screen.findByRole("heading", { name: "Agent worker settings" })).closest(
        "section",
      ) as HTMLElement,
    );
    for (const line of [
      "KICKROCKS_AGENT_PROVIDER=ollama",
      "KICKROCKS_AGENT_MODEL=gpt-oss:20b",
      "KICKROCKS_AGENT_BASE_URL=http://host.docker.internal:11434",
      `KICKROCKS_AGENT_NUM_CTX=${BENCH_NUM_CTX}`,
    ]) {
      expect(settings.getByText(new RegExp(line))).toBeVisible();
    }
    expect(settings.queryByText(/KICKROCKS_AGENT_THINKING/)).toBeNull();
  });

  it("changes every part when the card changes, and remembers the choice", async () => {
    const { user } = agents();
    await pickGpu(user, "12 GB");
    const agent = within(group("Agent model") as HTMLElement);
    expect(agent.getByText("qwen3:14b")).toBeVisible();
    expect(agent.getByText(/duplicate|new request to a site/i)).toBeVisible();
    expect(screen.getByText(/KICKROCKS_AGENT_THINKING=off/)).toBeVisible();
    expect(within(group("Reply model") as HTMLElement).getByText("95.8%")).toBeVisible();
    expect(localStorage.getItem(STORAGE_KEYS.gpuSize)).toBe("12");
  });

  it("starts from the remembered card", async () => {
    localStorage.setItem(STORAGE_KEYS.gpuSize, "8");
    agents();
    expect(await screen.findByLabelText("GPU memory")).toHaveValue("8");
    expect(within(group("Agent model") as HTMLElement).getByText("granite4.1:8b")).toBeVisible();
  });

  it("says plainly that a card under 8 GB has no agent model, and offers no gate for it", async () => {
    const { user } = agents();
    await pickGpu(user, "6 GB");
    expect(screen.getByText(/No local model this small drove a form well/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Safety gate" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Agent worker settings" })).toBeNull();
    expect(within(group("Reply model") as HTMLElement).getByText("llama3.2:3b")).toBeVisible();
  });

  it("sets the reply model on an ollama endpoint without touching its address or key", async () => {
    const mock = createMockApp();
    mock.store.settings.llm = {
      baseUrl: "http://10.0.0.5:11434/v1",
      model: "old-model",
      apiKeySet: true,
    };
    const { user } = agents(mock);
    await pickGpu(user, "8 GB");
    await user.click(await screen.findByRole("button", { name: "Use as the language model" }));
    await waitFor(() => expect(mock.store.settings.llm?.model).toBe("qwen3:8b"));
    expect(mock.store.settings.llm).toMatchObject({
      baseUrl: "http://10.0.0.5:11434/v1",
      apiKeySet: true,
    });
    expect(
      await screen.findByRole("button", { name: "In use as the language model" }),
    ).toBeDisabled();
  });

  it("points a hosted endpoint at ollama and drops its key, since that service has no such model", async () => {
    const mock = createMockApp();
    mock.store.settings.llm = {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKeySet: true,
    };
    const { user } = agents(mock);
    await pickGpu(user, "8 GB");
    await user.click(await screen.findByRole("button", { name: "Use as the language model" }));
    await waitFor(() => expect(mock.store.settings.llm?.model).toBe("qwen3:8b"));
    expect(mock.store.settings.llm).toMatchObject({
      baseUrl: "http://host.docker.internal:11434/v1",
      apiKeySet: false,
    });
  });

  it("offers the language model as a secondary action, so the page keeps one primary", async () => {
    agents();
    const button = await screen.findByRole("button", { name: "Use as the language model" });
    expect(button.className).not.toContain("bg-accent-fill");
  });
});

describe("the safety gate", () => {
  it("shows a model that passed here as cleared", async () => {
    agents();
    const gate = within(
      (await screen.findByRole("heading", { name: "Safety gate" })).closest(
        "section",
      ) as HTMLElement,
    );
    expect(gate.getByText("Cleared")).toBeVisible();
    expect(gate.getByText(/passed the safety gate on this install/)).toBeVisible();
    const run = within(
      screen.getByRole("heading", { name: "Run the gate" }).closest("section") as HTMLElement,
    );
    expect(run.getByText(/--scenarios 1,3,5,6,7,8,9,10 --runs 5 --record/)).toBeVisible();
    expect(run.getByText(/KICKROCKS_SERVER_URL=http:\/\/localhost:8420/)).toBeVisible();
    expect(run.getByText(/KICKROCKS_WORKER_TOKEN=<worker-token>/)).toBeVisible();
    expect(gate.queryByRole("checkbox", { name: /Allow without a pass/ })).not.toBeInTheDocument();
  });

  it("says each submit waits for the person when the model has no pass", async () => {
    const { user } = agents();
    await pickGpu(user, "12 GB");
    const gate = within(
      screen.getByRole("heading", { name: "Safety gate" }).closest("section") as HTMLElement,
    );
    expect(gate.getByText("Not cleared")).toBeVisible();
    expect(
      gate.getByText(/Every request its browser would send waits for you in Review/),
    ).toBeVisible();
    expect(screen.getByText(/--thinking off/)).toBeVisible();
  });

  it("lets the person choose how long a held send waits, and lists what the gate cannot see", async () => {
    const { user, mock } = agents();
    await pickGpu(user, "12 GB");
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
    expect(limits.getByText(/Bot sensors\./)).toBeVisible();
  });

  it("calls a pass for another build out of date once the worker reports the running build", async () => {
    const mock = createMockApp();
    mock.store.settings.worker.model = {
      workerId: "agent-home",
      version: "agent-0.1.0",
      lastSeenAt: new Date().toISOString(),
      busy: false,
      currentTaskId: null,
      model: {
        provider: "ollama",
        name: "gpt-oss:20b",
        version: "ffffffffffff",
        thinking: "default",
        numCtx: BENCH_NUM_CTX,
      },
    };
    agents(mock);
    const gate = within(
      (await screen.findByRole("heading", { name: "Safety gate" })).closest(
        "section",
      ) as HTMLElement,
    );
    expect(await gate.findByText("Pass out of date")).toBeVisible();
    expect(gate.getByText(/Agent worker runs/)).toBeVisible();
    expect(gate.getByText(/gpt-oss:20b \(ffffffffffff\), pass out of date/)).toBeVisible();
  });

  it("allows a model without a pass only after a warning, and takes the allowance back", async () => {
    const { user, mock } = agents();
    await pickGpu(user, "12 GB");
    await user.click(screen.getByRole("checkbox", { name: /Allow without a pass/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Nothing has shown this model is safe here/)).toBeVisible();
    expect(
      mock.store.settings.agent.gate.records.some(
        (record) => record.source === "override" && record.model.name === "qwen3:14b",
      ),
    ).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Allow it" }));
    await waitFor(() =>
      expect(
        mock.store.settings.agent.gate.records.some(
          (record) => record.source === "override" && record.model.name === "qwen3:14b",
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("Allowed by you")).toBeVisible();
    expect(screen.getByText(/nothing has checked that it is safe to/)).toBeVisible();

    await user.click(screen.getByRole("checkbox", { name: /Allow without a pass/ }));
    await waitFor(() =>
      expect(
        mock.store.settings.agent.gate.records.some((record) => record.model.name === "qwen3:14b"),
      ).toBe(false),
    );
  });

  it("lists what is cleared and lets an override be removed there", async () => {
    const { user, mock } = agents();
    const cleared = within(
      (await screen.findByRole("heading", { name: /Cleared models/ })).closest(
        "section",
      ) as HTMLElement,
    );
    expect(cleared.getByText("gpt-oss:20b")).toBeVisible();
    expect(cleared.getByText(/Passed 40 runs/)).toBeVisible();
    expect(cleared.getByText(/Allowed by you/)).toBeVisible();
    await user.click(cleared.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(mock.store.settings.agent.gate.records.map((record) => record.source)).toEqual([
        "bench",
      ]),
    );
  });
});
