import { describe, expect, it } from "vitest";
import { AGENT_SETUPS, applyAgentSetup } from "./agent-setup.js";
import { app, call, freshMockAppEachTest } from "./test-helpers.js";

freshMockAppEachTest();

const setup = async (query = "") => (await call({ path: `/settings/agent-setup${query}` })).json;

describe("the mock setups", () => {
  it("starts with no Ollama and no agent worker, so the other pages see what they always did", async () => {
    const view = await setup();
    expect(view.components.worker).toBeNull();
    expect(view.missing).toEqual(["ollama", "worker"]);
    expect(
      view.components.server.endpoints.map((endpoint: { source: string }) => endpoint.source),
    ).toEqual(["usual", "usual", "usual", "usual"]);
  });

  it("describes a small card whose GPU the worker cannot see", async () => {
    applyAgentSetup(app.store, "small6");
    const view = await setup();
    expect(view.components.worker.host.gpuProbe).toBe("no_tool");
    expect(view.sameOllama).toBe("yes");
    expect(view.missing).toEqual(["gpuMemory"]);
    expect(view.gpu.agent.atLeastGib).toBeCloseTo(3.8, 1);
  });

  it("describes a 16 GB desktop with its best model installed and cleared", async () => {
    applyAgentSetup(app.store, "gpu16");
    const view = await setup();
    expect(view.sameOllama).toBe("probably");
    expect(view.missing).toEqual([]);
    expect(view.recommendation.agent).toMatchObject({ name: "gpt-oss:20b", gate: "passed" });
    expect(view.recommendation.reply).toMatchObject({ name: "gpt-oss:20b", sameCopy: true });
  });

  it("leaves the best model uncleared in its own setup, and takes no agent model from an old worker", async () => {
    applyAgentSetup(app.store, "gpu16-uncleared");
    expect((await setup()).recommendation.agent.gate).toBe("unproven");
    applyAgentSetup(app.store, "gpu16-old-worker");
    expect((await setup()).components.worker.acceptsAgentModel).toBe(false);
  });

  it("has a setup for a hosted agent model, which gets no agent recommendation", async () => {
    applyAgentSetup(app.store, "gpu16-hosted");
    const view = await setup();
    expect(view.recommendation.agent).toBeNull();
    expect(view.recommendation.reply).not.toBeNull();
  });

  it("probes an address the person typed, and refuses one nothing answers", async () => {
    applyAgentSetup(app.store, "gpu16");
    const found = await call({
      method: "POST",
      path: "/settings/agent-setup/probe",
      body: { baseUrl: "http://desktop:11434/v1" },
    });
    expect(found.json).toMatchObject({
      reachable: true,
      source: "asked",
      baseUrl: "http://desktop:11434",
    });
    const missing = await call({
      method: "POST",
      path: "/settings/agent-setup/probe",
      body: { baseUrl: "http://nowhere:11434" },
    });
    expect(missing.json).toMatchObject({ reachable: false, error: "unreachable" });
  });

  it("knows every setup by name", () => {
    for (const name of AGENT_SETUPS) applyAgentSetup(app.store, name);
  });
});

describe("saving the agent model in the mock", () => {
  it("takes a listed model and moves the worker onto it, and puts the worker's own setting back on null", async () => {
    applyAgentSetup(app.store, "gpu16");
    const choice = { name: "gpt-oss:20b", thinking: "default", numCtx: 16_384 };
    const saved = await call({
      method: "PATCH",
      path: "/settings",
      body: { agent: { model: choice } },
    });
    expect(saved.json.agent.model).toEqual(choice);
    expect(saved.json.worker.model.model).toMatchObject({
      name: "gpt-oss:20b",
      version: "aa1c7e3b9d20",
    });
    const cleared = await call({
      method: "PATCH",
      path: "/settings",
      body: { agent: { model: null } },
    });
    expect(cleared.json.agent.model).toBeNull();
  });

  it("refuses a model the worker does not list with a 409, as the server does", async () => {
    applyAgentSetup(app.store, "gpu16");
    const refused = await call({
      method: "PATCH",
      path: "/settings",
      body: { agent: { model: { name: "nothing:1b", thinking: "default", numCtx: 16_384 } } },
    });
    expect(refused.status).toBe(409);
    expect(refused.json.error).toBe("model_not_installed");
  });

  it("keeps the answer to the GPU question for each side", async () => {
    const first = await call({
      method: "PATCH",
      path: "/settings",
      body: { agent: { gpuMemoryGb: { worker: 12 } } },
    });
    expect(first.json.agent.gpuMemoryGb).toEqual({ worker: 12, server: null });
    const second = await call({
      method: "PATCH",
      path: "/settings",
      body: { agent: { gpuMemoryGb: { server: 8 } } },
    });
    expect(second.json.agent.gpuMemoryGb).toEqual({ worker: 12, server: 8 });
  });
});
