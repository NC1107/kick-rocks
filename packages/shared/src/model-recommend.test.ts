import { describe, expect, it } from "vitest";
import type { GateState } from "./agent-models.js";
import { compareOllamas } from "./agent-setup.js";
import {
  agentEnvLines,
  BENCH_NUM_CTX,
  type GpuMemory,
  gateCommand,
  gibFromBytes,
  MEASURED_MODELS,
  type RecommendInputs,
  recommendSetup,
  UNKNOWN_GPU,
} from "./model-recommend.js";

const ALL = MEASURED_MODELS.map((model) => model.name);

const card = (gib: number): GpuMemory => ({ gib, atLeastGib: null, lessThanGib: null });

function inputs(overrides: Partial<RecommendInputs> = {}): RecommendInputs {
  return {
    hostedProvider: null,
    workerSeen: true,
    agentInstalled: ALL,
    replyInstalled: ALL,
    sameOllama: true,
    agentGpu: card(16),
    replyGpu: card(16),
    gate: {},
    ...overrides,
  };
}

const onCard = (gib: number, extra: Partial<RecommendInputs> = {}) =>
  recommendSetup(inputs({ agentGpu: card(gib), replyGpu: card(gib), ...extra }));

describe("the recommendation for each card size", () => {
  it.each([
    [6, null, "llama3.2:3b"],
    [8, "granite4.1:8b", "qwen3:8b"],
    [12, "qwen3:14b", "qwen3:14b"],
    [16, "gpt-oss:20b", "gpt-oss:20b"],
    [24, "gpt-oss:20b", "gpt-oss:20b"],
  ])("reproduces the docs table on %i GB with everything installed", (gib, agent, reply) => {
    const result = onCard(gib);
    expect(result.agent?.name ?? null).toBe(agent);
    expect(result.reply?.name).toBe(reply);
    expect(result.pull).toBeNull();
    expect(result.needs).toEqual([]);
  });

  it("keeps half a GiB of headroom, so gpt-oss:20b does not fit a 12 GB card", () => {
    expect(onCard(12).agent?.name).toBe("qwen3:14b");
    expect(onCard(12.4).agent?.name).toBe("gpt-oss:20b");
  });

  it("always runs the agent at the context the gate is keyed on, with the measured thinking", () => {
    expect(onCard(12).agent).toMatchObject({ numCtx: BENCH_NUM_CTX, thinking: "off" });
    expect(onCard(16).agent).toMatchObject({ numCtx: BENCH_NUM_CTX, thinking: "default" });
  });

  it("explains the choice in one line per job", () => {
    const result = onCard(16);
    expect(result.reasons.agent).toBe(
      "Your 16 GB card holds gpt-oss:20b, the only model with no safety mistake in the benchmark.",
    );
    expect(result.reasons.reply).toMatch(/gpt-oss:20b.*same loaded copy/);
  });

  it("says why a 6 GB card gets no agent model", () => {
    expect(onCard(6).reasons.agent).toMatch(/No local model this small drove a form well/);
  });
});

describe("only what is installed is recommended", () => {
  it("recommends the best installed model that fits, and says what to pull for a better one", () => {
    const result = onCard(16, { agentInstalled: ["qwen3:14b"], replyInstalled: ["qwen3:14b"] });
    expect(result.agent?.name).toBe("qwen3:14b");
    expect(result.pull).toBe("ollama pull gpt-oss:20b");
  });

  it("makes the pull line the recommendation when no measured model is installed", () => {
    const result = onCard(16, { agentInstalled: [], replyInstalled: [] });
    expect(result.agent).toBeNull();
    expect(result.reply).toBeNull();
    expect(result.pull).toBe("ollama pull gpt-oss:20b");
  });

  it("never recommends an installed model that was not measured", () => {
    const result = onCard(24, {
      agentInstalled: ["llama3.3:70b", "mistral-small3.2", "qwen3.6:35b-a3b"],
      replyInstalled: ["llama3.3:70b", "mistral-small3.2", "qwen3.6:35b-a3b"],
    });
    expect(result.agent).toBeNull();
    expect(result.reply).toBeNull();
    expect(result.pull).toBe("ollama pull gpt-oss:20b");
  });

  it("reads a model pulled without a tag as the :latest spelling of the same name", () => {
    const result = onCard(16, {
      agentInstalled: ["gpt-oss:20b"],
      replyInstalled: ["llama3.2:3b", "llama3.2:3b:latest"],
    });
    expect(result.agent?.name).toBe("gpt-oss:20b");
  });
});

describe("the safety gate decides between models that fit", () => {
  it("prefers a cleared model over an uncleared one that ranks higher", () => {
    const gate: Record<string, GateState> = { "qwen3:14b": "passed", "gpt-oss:20b": "unproven" };
    const result = onCard(16, { gate });
    expect(result.agent).toMatchObject({ name: "qwen3:14b", gate: "passed" });
    expect(result.pull).toBeNull();
  });

  it("puts a model the person allowed after one that passed, and before the rest", () => {
    const first = onCard(16, { gate: { "granite4.1:8b": "override", "qwen3:14b": "passed" } });
    expect(first.agent?.name).toBe("qwen3:14b");
    const second = onCard(16, { gate: { "granite4.1:8b": "override" } });
    expect(second.agent?.name).toBe("granite4.1:8b");
  });
});

describe("when the size of the card is not known", () => {
  it("asks for it and recommends nothing it cannot be sure fits", () => {
    const result = recommendSetup(inputs({ agentGpu: UNKNOWN_GPU, replyGpu: UNKNOWN_GPU }));
    expect(result.needs).toContain("gpuMemory");
    expect(result.agent).toBeNull();
    expect(result.pull).toBeNull();
  });

  it("uses a loaded model fully on the card as a floor", () => {
    const floor = { gib: null, atLeastGib: 12.4, lessThanGib: null };
    const result = recommendSetup(inputs({ agentGpu: floor, replyGpu: floor }));
    expect(result.agent?.name).toBe("gpt-oss:20b");
    expect(result.needs).toEqual(["gpuMemory"]);
  });

  it("rules out models at least as big as one that spilled to the CPU", () => {
    const ceiling = { gib: null, atLeastGib: 8, lessThanGib: 11.9 };
    const result = recommendSetup(inputs({ agentGpu: ceiling, replyGpu: ceiling }));
    expect(result.agent?.name).toBe("granite4.1:8b");
  });
});

describe("a hosted provider", () => {
  it("gets no agent recommendation, but replies are still recommended", () => {
    const result = recommendSetup(
      inputs({ hostedProvider: { provider: "openai", model: "gpt-5-mini" } }),
    );
    expect(result.agent).toBeNull();
    expect(result.reasons.agent).toBeNull();
    expect(result.reply?.name).toBe("qwen3:8b");
    expect(result.reply?.sameCopy).toBe(false);
  });
});

describe("the reply model", () => {
  it("shares the agent's loaded copy only when both reach the same Ollama", () => {
    expect(onCard(16, { sameOllama: true }).reply).toMatchObject({
      name: "gpt-oss:20b",
      sameCopy: true,
    });
    expect(onCard(16, { sameOllama: false }).reply).toMatchObject({
      name: "qwen3:8b",
      sameCopy: false,
    });
  });

  it("does not share a copy the reply Ollama does not have installed", () => {
    const result = onCard(16, { sameOllama: true, replyInstalled: ["qwen3:8b"] });
    expect(result.reply).toMatchObject({ name: "qwen3:8b", sameCopy: false });
  });

  it("does not share a copy that is not accurate enough", () => {
    const result = onCard(8);
    expect(result.agent?.name).toBe("granite4.1:8b");
    expect(result.reply).toMatchObject({ name: "qwen3:8b", sameCopy: false });
  });

  it("uses what the server's own Ollama has when it differs from the worker's", () => {
    const result = onCard(16, { sameOllama: false, replyInstalled: ["llama3.2:3b"] });
    expect(result.reply?.name).toBe("llama3.2:3b");
  });
});

describe("what is missing", () => {
  it("lists a missing Ollama and a worker that never reported", () => {
    const result = recommendSetup(
      inputs({ agentInstalled: null, replyInstalled: null, workerSeen: false }),
    );
    expect(result.needs).toEqual(["ollama", "worker"]);
  });

  it("previews the agent model from the server's Ollama when no worker has reported", () => {
    const result = recommendSetup(inputs({ agentInstalled: null, workerSeen: false }));
    expect(result.agent?.name).toBe("gpt-oss:20b");
    expect(result.needs).toEqual(["worker"]);
  });
});

describe("the agent worker's settings", () => {
  it("writes the lines to put in .env, with thinking off only where it was measured off", () => {
    expect(agentEnvLines({ name: "qwen3:14b", thinking: "off" })).toContain(
      "KICKROCKS_AGENT_THINKING=off",
    );
    const lines = agentEnvLines(
      { name: "gpt-oss:20b", thinking: "default" },
      "http://desktop:11434",
    );
    expect(lines.join("\n")).not.toContain("THINKING");
    expect(lines).toEqual(
      expect.arrayContaining([
        "KICKROCKS_AGENT_PROVIDER=ollama",
        "KICKROCKS_AGENT_MODEL=gpt-oss:20b",
        "KICKROCKS_AGENT_BASE_URL=http://desktop:11434",
        "KICKROCKS_AGENT_NUM_CTX=16384",
        "KICKROCKS_AGENT_WORKER_ID=agent-worker",
      ]),
    );
  });

  it("writes the gate command with the same settings the worker will run with", () => {
    expect(gateCommand({ name: "qwen3:14b", thinking: "off" }, "https://kr.example.org")).toBe(
      [
        "KICKROCKS_SERVER_URL=https://kr.example.org \\",
        "KICKROCKS_WORKER_TOKEN=<worker-token> \\",
        "pnpm --filter @kickrocks/agent-worker bench \\",
        "  --model qwen3:14b --provider ollama --num-ctx 16384 --thinking off \\",
        "  --agent-only --scenarios 1,3,5,6,7,8,9,10 --runs 5 --record",
      ].join("\n"),
    );
  });

  it("reads a card sold as 8 GB as 8", () => {
    expect(gibFromBytes(8188 * 1024 * 1024)).toBe(8);
    expect(gibFromBytes(16303 * 1024 * 1024)).toBe(15.9);
  });
});

describe("whether two addresses reach one Ollama", () => {
  const library = [{ name: "gpt-oss:20b", digest: "sha256:aaa" }];
  const at = (baseUrl: string, version = "0.12.0", models = library) => ({
    baseUrl,
    version,
    models,
  });

  it("calls the same address the same, and an identical library probably the same", () => {
    expect(compareOllamas(at("http://10.0.0.5:11434"), at("http://10.0.0.5:11434/"))).toBe("yes");
    expect(compareOllamas(at("http://desktop.lan:11434"), at("http://10.0.0.5:11434"))).toBe(
      "probably",
    );
  });

  it.each([
    "http://host.docker.internal:11434",
    "http://localhost:11434",
    "http://127.0.0.1:11434",
    "http://172.17.0.1:11434",
    "http://ollama:11434",
  ])("does not take %s on two machines for one server", (address) => {
    const server = at(address, "0.12.0", [{ name: "qwen3:8b", digest: "sha256:aaa" }]);
    const worker = at(address, "0.12.0", [{ name: "gpt-oss:20b", digest: "sha256:bbb" }]);
    expect(compareOllamas(worker, server)).toBe("no");
  });

  it("calls a different version or a different digest a different server", () => {
    expect(compareOllamas(at("http://a:11434"), at("http://b:11434", "0.13.0"))).toBe("no");
    expect(
      compareOllamas(
        at("http://a:11434"),
        at("http://b:11434", "0.12.0", [{ name: "gpt-oss:20b", digest: "sha256:bbb" }]),
      ),
    ).toBe("no");
  });

  it("does not guess from an empty library or a missing side", () => {
    expect(compareOllamas(at("http://a:11434", "0.12.0", []), at("http://b:11434"))).toBe(
      "unknown",
    );
    expect(compareOllamas(null, at("http://b:11434"))).toBe("unknown");
  });
});
