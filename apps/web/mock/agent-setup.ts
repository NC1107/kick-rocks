import {
  API_ROUTES,
  agentSetupCandidates,
  BENCH_NUM_CTX,
  composeAgentSetup,
  type ModelIdentity,
  type OllamaLoaded,
  type OllamaModel,
  type ProbeResult,
  type WorkerHost,
  type WorkerOllama,
  type WorkerStatus,
} from "@kickrocks/shared";
import { defineMockDomain, handle } from "./core.js";
import type { MockStore } from "./store.js";

/** What answers at one address on the mock network. Any address not listed refuses the connection. */
export interface MockOllamaHost {
  version: string;
  models: OllamaModel[];
  loaded: OllamaLoaded[];
}

const GIB = 1024 ** 3;

function model(name: string, digest: string, sizeGb: number, parameterSize: string): OllamaModel {
  return {
    name,
    digest,
    sizeBytes: Math.round(sizeGb * GIB),
    parameterSize,
    quantization: "Q4_K_M",
  };
}

/** The digest of gpt-oss:20b the fixture gate records were earned on. */
const GPT_OSS_DIGEST = "aa1c7e3b9d20";

const LIBRARY_16: OllamaModel[] = [
  { ...model("gpt-oss:20b", GPT_OSS_DIGEST, 13, "20.9B"), quantization: "MXFP4" },
  model("qwen3:14b", "bb02f1c4a7e1", 9.3, "14.8B"),
  model("qwen3:8b", "cc13a2d5b8f2", 5.2, "8.2B"),
  model("llama3.2:3b", "dd24b3e6c9a3", 2, "3.2B"),
  model("granite4.1:8b", "ee35c4f7dab4", 5.3, "8.2B"),
  model("mistral-small3.2", "ff46d508ebc5", 15, "24B"),
  model("nomic-embed-text", "0a57e619fcd6", 0.3, "137M"),
];

const LIBRARY_6: OllamaModel[] = [
  model("llama3.2:3b", "dd24b3e6c9a3", 2, "3.2B"),
  model("qwen3:4b", "1b68f72a0de7", 2.5, "4.0B"),
  model("nomic-embed-text", "0a57e619fcd6", 0.3, "137M"),
];

export const AGENT_SETUPS = [
  "none",
  "small6",
  "gpu16",
  "gpu16-uncleared",
  "gpu16-old-worker",
  "gpu16-hosted",
  /** Nothing set up: no browser worker, no agent worker, no Ollama, agent access off. */
  "empty",
  /** Every helper running and reachable, with agent access on. */
  "ready",
] as const;
export type AgentSetupName = (typeof AGENT_SETUPS)[number];

function host(
  gpu: { name: string; gib: number } | null,
  gpuProbe: WorkerHost["gpuProbe"],
): WorkerHost {
  return {
    hostname: "nick-desktop",
    platform: "linux",
    arch: "x64",
    cpuCores: 16,
    memoryBytes: 64 * GIB,
    gpus: gpu
      ? [
          {
            vendor: "nvidia",
            name: gpu.name,
            memoryBytes: Math.round(gpu.gib * 1024) * 1024 * 1024,
          },
        ]
      : gpuProbe === "ok"
        ? []
        : null,
    gpuProbe,
  };
}

function workerFor(
  store: MockStore,
  parts: {
    host: WorkerHost;
    ollama: WorkerOllama | null;
    accepts: boolean;
    model: ModelIdentity;
  },
): WorkerStatus {
  return {
    workerId: "nick-desktop-agent",
    version: "agent-0.1.0",
    lastSeenAt: store.ago({ minutes: 0 }),
    busy: false,
    currentTaskId: null,
    model: parts.model,
    host: parts.host,
    ...(parts.ollama ? { ollama: parts.ollama } : {}),
    accepts: parts.accepts ? ["agentModel"] : [],
  };
}

function ollamaIdentity(name: string, digest: string): ModelIdentity {
  return { provider: "ollama", name, version: digest, thinking: "default", numCtx: BENCH_NUM_CTX };
}

function ollamaOf(
  store: MockStore,
  baseUrl: string,
  colocated: boolean,
  hostEntry: MockOllamaHost,
): WorkerOllama {
  return {
    baseUrl,
    colocated,
    reachable: true,
    error: null,
    version: hostEntry.version,
    models: hostEntry.models,
    loaded: hostEntry.loaded,
    checkedAt: store.ago({ minutes: 0 }),
  };
}

/**
 * Sets the mock to one of a few realistic installs, for the walk through the Helpers section and
 * for tests: no Ollama at all, a small card, and a 16 GB desktop with the benchmark's best model.
 * `empty` and `ready` also set the browser worker and agent access, for the two ends of Helpers.
 */
export function applyAgentSetup(store: MockStore, setup: AgentSetupName): void {
  const { settings } = store;
  const name = setup === "empty" ? "none" : setup === "ready" ? "gpu16" : setup;
  if (setup === "empty" || setup === "ready") {
    const ready = setup === "ready";
    settings.worker = {
      enabled: true,
      model: null,
      builtin: ready
        ? {
            workerId: "worker-home",
            version: "0.1.0",
            lastSeenAt: store.ago({ minutes: 0 }),
            busy: false,
            currentTaskId: null,
          }
        : null,
    };
    settings.mcp = { ...settings.mcp, enabled: ready, tokenSet: ready };
  }
  store.agentNetwork = {};
  settings.agent = { ...settings.agent, model: null, gpuMemoryGb: { worker: null, server: null } };
  settings.llm = null;
  settings.worker = { ...settings.worker, model: null };

  if (name === "none") return;

  if (name === "small6") {
    const entry: MockOllamaHost = {
      version: "0.12.3",
      models: LIBRARY_6,
      loaded: [
        {
          name: "llama3.2:3b",
          sizeBytes: Math.round(3.8 * GIB),
          sizeVramBytes: Math.round(3.8 * GIB),
          contextLength: 4096,
        },
      ],
    };
    store.agentNetwork["host.docker.internal:11434"] = entry;
    settings.worker.model = workerFor(store, {
      host: host(null, "no_tool"),
      ollama: ollamaOf(store, "http://host.docker.internal:11434", true, entry),
      accepts: true,
      model: ollamaIdentity("llama3.2:3b", "dd24b3e6c9a3"),
    });
    return;
  }

  const desktop: MockOllamaHost = {
    version: "0.12.3",
    models: LIBRARY_16,
    loaded: [
      {
        name: "gpt-oss:20b",
        sizeBytes: Math.round(12.7 * GIB),
        sizeVramBytes: Math.round(12.7 * GIB),
        contextLength: BENCH_NUM_CTX,
      },
    ],
  };
  store.agentNetwork["desktop:11434"] = desktop;
  settings.llm = { baseUrl: "http://desktop:11434/v1", model: "qwen3:8b", apiKeySet: false };

  const hosted: ModelIdentity = {
    provider: "openai",
    name: "gpt-5-mini",
    version: null,
    thinking: "default",
    numCtx: null,
  };
  settings.worker.model = workerFor(store, {
    host: host({ name: "NVIDIA GeForce RTX 5080", gib: 15.92 }, "ok"),
    ollama:
      name === "gpu16-hosted" ? null : ollamaOf(store, "http://localhost:11434", true, desktop),
    accepts: name !== "gpu16-old-worker",
    model: name === "gpu16-hosted" ? hosted : ollamaIdentity("qwen3:8b", "cc13a2d5b8f2"),
  });
  if (name === "gpu16-uncleared") {
    settings.agent = { ...settings.agent, gate: { ...settings.agent.gate, records: [] } };
  }
}

function probe(
  store: MockStore,
  candidate: { baseUrl: string; source: ProbeResult["source"] },
): ProbeResult {
  const entry = store.agentNetwork[new URL(candidate.baseUrl).host];
  if (!entry) {
    return {
      ...candidate,
      reachable: false,
      error: "unreachable",
      version: null,
      models: [],
      loaded: [],
    };
  }
  return {
    ...candidate,
    reachable: true,
    error: null,
    version: entry.version,
    models: entry.models,
    loaded: entry.loaded,
  };
}

export default defineMockDomain({
  name: "agent-setup",

  seed(store) {
    store.agentNetwork = {};
  },

  routes(store) {
    return [
      handle(API_ROUTES.settingsAgentSetup, ({ query }) => {
        const worker = store.settings.worker.model;
        const candidates = agentSetupCandidates({
          ask: query.ask ?? null,
          savedBaseUrl: store.settings.llm?.baseUrl ?? null,
          workerBaseUrl: worker?.ollama?.baseUrl ?? null,
        });
        return composeAgentSetup({
          worker,
          endpoints: candidates.map((candidate) => probe(store, candidate)),
          answers: store.settings.agent.gpuMemoryGb,
          gateRecords: store.settings.agent.gate.records,
        });
      }),

      handle(API_ROUTES.settingsAgentSetupProbe, ({ body }) =>
        probe(store, {
          baseUrl: body.baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, ""),
          source: "asked",
        }),
      ),
    ];
  },
});
