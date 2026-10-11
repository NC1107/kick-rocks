import { z } from "zod";
import { type GateRecord, type GateState, GateVerdict, gateVerdict } from "./agent-models.js";
import {
  BENCH_NUM_CTX,
  type GpuMemory,
  GpuMemorySchema,
  gibFromBytes,
  measuredThinking,
  Recommendation,
  recommendSetup,
  SetupNeed,
  UNKNOWN_GPU,
} from "./model-recommend.js";
import type { GpuMemoryAnswers, WorkerStatus } from "./settings.js";
import { WebUrl } from "./url.js";
import {
  canonicalModelName,
  OllamaLoaded,
  OllamaModel,
  WorkerHost,
  WorkerOllama,
} from "./worker-inventory.js";

/** The ports and hosts the server tries for a reply model when none is configured. No network is scanned. */
export const DEFAULT_OLLAMA_ADDRESSES = [
  "http://127.0.0.1:11434",
  "http://host.docker.internal:11434",
  "http://172.17.0.1:11434",
  "http://ollama:11434",
] as const;

export const ProbeSource = z.enum(["saved", "worker", "usual", "asked"]);
export type ProbeSource = z.infer<typeof ProbeSource>;

export const ProbeError = z.enum([
  "unreachable",
  "timeout",
  "bad_response",
  "redirect",
  "too_large",
]);
export type ProbeError = z.infer<typeof ProbeError>;

/** What the server found at one address, with only parsed fields and never a raw body. */
export const ProbeResult = z.object({
  /** Without credentials and without `/v1`. */
  baseUrl: z.string().max(500),
  source: ProbeSource,
  reachable: z.boolean(),
  error: ProbeError.nullable(),
  version: z.string().max(100).nullable(),
  models: z.array(OllamaModel).max(200),
  loaded: z.array(OllamaLoaded).max(200),
});
export type ProbeResult = z.infer<typeof ProbeResult>;

export const AgentSetupQuery = z.object({
  /** An address the person typed, probed first and listed with the others. */
  ask: WebUrl.optional(),
});
export type AgentSetupQuery = z.infer<typeof AgentSetupQuery>;

export const AgentSetupProbeBody = z.object({ baseUrl: WebUrl });
export type AgentSetupProbeBody = z.infer<typeof AgentSetupProbeBody>;

export const SameOllama = z.enum(["yes", "probably", "no", "unknown"]);
export type SameOllama = z.infer<typeof SameOllama>;

export const GpuSource = z.enum(["worker_gpu", "asked", "loaded_model"]);
export type GpuSource = z.infer<typeof GpuSource>;

export const GpuReading = GpuMemorySchema.extend({ source: GpuSource.nullable() });
export type GpuReading = z.infer<typeof GpuReading>;

export const AgentSetupView = z.object({
  components: z.object({
    server: z.object({ endpoints: z.array(ProbeResult) }),
    worker: z
      .object({
        status: z.object({
          workerId: z.string(),
          version: z.string().nullable(),
          lastSeenAt: z.iso.datetime(),
          busy: z.boolean(),
          /** The model it last said it drives, and what became of the last choice offered to it. */
          model: z
            .object({
              provider: z.enum(["ollama", "openai", "anthropic"]),
              name: z.string(),
              thinking: z.enum(["default", "off"]),
              numCtx: z.number().nullable(),
            })
            .nullable(),
          agentModelState: z.enum(["applied", "not_installed", "unsupported_provider"]).nullable(),
        }),
        host: WorkerHost.nullable(),
        ollama: WorkerOllama.nullable(),
        acceptsAgentModel: z.boolean(),
      })
      .nullable(),
  }),
  /** The address replies would use: the first one that answered. Null when none did. */
  replyEndpoint: z.string().nullable(),
  sameOllama: SameOllama,
  /** The gate state of each model installed on the agent's Ollama, off the real digest. */
  installedGate: z.array(z.object({ name: z.string(), verdict: GateVerdict })),
  gpu: z.object({ agent: GpuReading, reply: GpuReading }),
  recommendation: Recommendation,
  missing: z.array(SetupNeed),
});
export type AgentSetupView = z.infer<typeof AgentSetupView>;

interface OllamaFingerprint {
  baseUrl: string;
  version: string | null;
  models: readonly { name: string; digest: string }[];
}

function hostAndPort(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return null;
  }
}

/**
 * Whether two addresses reach one Ollama. Nothing reports an identity, so the same address is the
 * only sure answer, and matching versions with matching (name, digest) pairs is a good guess.
 * An empty library matches too many servers to say anything.
 */
export function compareOllamas(
  a: OllamaFingerprint | null,
  b: OllamaFingerprint | null,
): SameOllama {
  if (a === null || b === null) return "unknown";
  const addressA = hostAndPort(a.baseUrl);
  if (addressA !== null && addressA === hostAndPort(b.baseUrl)) return "yes";
  if (a.models.length === 0 || b.models.length === 0) return "unknown";
  if (a.version !== b.version) return "no";
  const key = (model: { name: string; digest: string }) =>
    `${canonicalModelName(model.name)}@${model.digest}`;
  const left = new Set(a.models.map(key));
  const right = new Set(b.models.map(key));
  if (left.size !== right.size) return "no";
  for (const entry of left) if (!right.has(entry)) return "no";
  return "probably";
}

const BYTES_PER_GIB = 1024 ** 3;

/** A loaded model fully on the card is a floor for its size, and one spilled to the CPU is a ceiling. */
function boundsOf(loaded: readonly OllamaLoaded[]): Pick<GpuMemory, "atLeastGib" | "lessThanGib"> {
  let atLeast: number | null = null;
  let lessThan: number | null = null;
  for (const model of loaded) {
    if (model.sizeBytes <= 0) continue;
    const gib = model.sizeBytes / BYTES_PER_GIB;
    if (model.sizeVramBytes >= model.sizeBytes) atLeast = Math.max(atLeast ?? 0, gib);
    else lessThan = Math.min(lessThan ?? Number.POSITIVE_INFINITY, gib);
  }
  return { atLeastGib: atLeast, lessThanGib: lessThan };
}

/**
 * What is known about the card an Ollama runs on. The worker's own reading counts only when its
 * Ollama is on the same machine. The person's answer is exact, so it beats a bound worked out
 * from what is loaded.
 */
function readGpu(
  reading: { colocated: boolean; gpuBytes: number | null; loaded: readonly OllamaLoaded[] },
  asked: number | null,
): GpuReading {
  const bounds = boundsOf(reading.loaded);
  if (reading.colocated && reading.gpuBytes !== null && reading.gpuBytes > 0) {
    return { gib: gibFromBytes(reading.gpuBytes), ...bounds, source: "worker_gpu" };
  }
  if (asked !== null) return { gib: asked, ...bounds, source: "asked" };
  const source = bounds.atLeastGib !== null || bounds.lessThanGib !== null ? "loaded_model" : null;
  return { ...UNKNOWN_GPU, ...bounds, source };
}

function largestGpuBytes(worker: WorkerStatus | null): number | null {
  const gpus = worker?.host?.gpus;
  if (!gpus || gpus.length === 0) return null;
  return Math.max(...gpus.map((gpu) => gpu.memoryBytes));
}

export interface AgentSetupFacts {
  worker: WorkerStatus | null;
  /** What each address answered, in the order they were tried. */
  endpoints: readonly ProbeResult[];
  answers: GpuMemoryAnswers;
  gateRecords: readonly GateRecord[];
}

/**
 * Turns what was found into the view: how the two Ollamas relate, which card each runs on, the
 * gate state of what is installed, and the one setup to recommend. It does no I/O, so the server
 * and the mock server run the same rules.
 */
export function composeAgentSetup(facts: AgentSetupFacts): AgentSetupView {
  const { worker, endpoints, answers } = facts;
  const reply = endpoints.find((endpoint) => endpoint.reachable) ?? null;
  const workerOllama = worker?.ollama?.reachable ? worker.ollama : null;

  const sameOllama = compareOllamas(
    workerOllama,
    reply ? { baseUrl: reply.baseUrl, version: reply.version, models: reply.models } : null,
  );
  const shared = sameOllama === "yes" || sameOllama === "probably";

  const agentGpu = workerOllama
    ? readGpu(
        {
          colocated: workerOllama.colocated,
          gpuBytes: largestGpuBytes(worker),
          loaded: workerOllama.loaded,
        },
        answers.worker,
      )
    : readGpu({ colocated: false, gpuBytes: null, loaded: reply?.loaded ?? [] }, answers.server);
  const ownReplyGpu = readGpu(
    { colocated: false, gpuBytes: null, loaded: reply?.loaded ?? [] },
    answers.server,
  );
  const replyGpu = (shared || reply === null) && agentGpu.gib !== null ? agentGpu : ownReplyGpu;

  const inventory = workerOllama?.models ?? reply?.models ?? [];
  const installedGate = inventory.map((model) => ({
    name: model.name,
    verdict: gateVerdict(facts.gateRecords, {
      provider: "ollama",
      name: model.name,
      version: model.digest === "" ? null : model.digest,
      thinking: measuredThinking(model.name),
      numCtx: BENCH_NUM_CTX,
    }),
  }));
  const gate: Record<string, GateState> = {};
  for (const entry of installedGate) gate[canonicalModelName(entry.name)] = entry.verdict.state;

  const provider = worker?.model?.provider ?? null;
  const recommendation = recommendSetup({
    hostedProvider:
      worker?.model && provider !== null && provider !== "ollama"
        ? { provider, model: worker.model.name }
        : null,
    workerSeen: worker !== null,
    agentInstalled: workerOllama ? workerOllama.models.map((model) => model.name) : null,
    replyInstalled: reply ? reply.models.map((model) => model.name) : null,
    sameOllama: shared,
    agentGpu,
    replyGpu,
    gate,
  });

  return {
    components: {
      server: { endpoints: [...endpoints] },
      worker: worker
        ? {
            status: {
              workerId: worker.workerId,
              version: worker.version,
              lastSeenAt: worker.lastSeenAt,
              busy: worker.busy,
              model: worker.model
                ? {
                    provider: worker.model.provider,
                    name: worker.model.name,
                    thinking: worker.model.thinking,
                    numCtx: worker.model.numCtx,
                  }
                : null,
              agentModelState: worker.agentModelState ?? null,
            },
            host: worker.host ?? null,
            ollama: worker.ollama ?? null,
            acceptsAgentModel: worker.accepts?.includes("agentModel") ?? false,
          }
        : null,
    },
    replyEndpoint: reply?.baseUrl ?? null,
    sameOllama,
    installedGate,
    gpu: { agent: agentGpu, reply: replyGpu },
    recommendation,
    missing: recommendation.needs,
  };
}

/** Without credentials, `/v1`, a trailing slash, a query or a fragment. */
export function normalizeOllamaUrl(address: string): string | null {
  try {
    const url = new URL(address);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const path = url.pathname.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

/** What a container calls the machine it runs on, which a server on another machine cannot reach the same way. */
const DOCKER_HOST_NAMES = new Set([
  "host.docker.internal",
  "gateway.docker.internal",
  "host-gateway",
  "host.containers.internal",
]);

function hostOf(address: string): string | null {
  try {
    return new URL(address).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "::1" || host === "0.0.0.0" || /^127\./.test(host);
}

/** A private IPv4 address, or a name that only resolves inside a home or office network. */
export function isLanHost(host: string): boolean {
  if (isLoopback(host) || DOCKER_HOST_NAMES.has(host)) return false;
  const octets = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (octets) {
    const [a, b] = [Number(octets[1]), Number(octets[2])];
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  return !host.includes(".") || /\.(local|lan|home|home\.arpa|internal|localdomain)$/.test(host);
}

function addressKey(address: string): string {
  try {
    const url = new URL(address);
    return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return address;
  }
}

export interface SetupCandidate {
  baseUrl: string;
  source: ProbeSource;
}

/**
 * The addresses to try, in order: the one the person typed, the saved reply endpoint, the
 * address the agent worker reported when it is on the network and not loopback, and, only while no
 * reply model is configured, the few places Ollama usually is. Nothing scans the network.
 */
export function agentSetupCandidates(input: {
  ask: string | null;
  savedBaseUrl: string | null;
  workerBaseUrl: string | null;
}): SetupCandidate[] {
  const found: SetupCandidate[] = [];
  const add = (address: string | null, source: ProbeSource) => {
    const baseUrl = address ? normalizeOllamaUrl(address) : null;
    if (baseUrl === null) return;
    if (found.some((candidate) => addressKey(candidate.baseUrl) === addressKey(baseUrl))) return;
    found.push({ baseUrl, source });
  };
  add(input.ask, "asked");
  add(input.savedBaseUrl, "saved");
  const workerHost = input.workerBaseUrl ? hostOf(input.workerBaseUrl) : null;
  if (input.workerBaseUrl && workerHost && isLanHost(workerHost))
    add(input.workerBaseUrl, "worker");
  if (input.savedBaseUrl === null)
    for (const address of DEFAULT_OLLAMA_ADDRESSES) add(address, "usual");
  return found;
}
