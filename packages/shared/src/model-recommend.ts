import { z } from "zod";
import { GATE_RUNS_PER_SCENARIO, GATE_SCENARIOS, GateState } from "./agent-models.js";
import { canonicalModelName } from "./worker-inventory.js";

/** The context window every measurement used, and the one the safety gate is keyed on. */
export const BENCH_NUM_CTX = 16_384;

/** Room left on the card for the desktop and the context cache, on top of what the model measured. */
export const FIT_HEADROOM_GIB = 0.5;

/** A pass below this accuracy is not enough to let the reply job share the agent's loaded model. */
export const SHARED_REPLY_MIN_ACCURACY_PCT = 94;

/** Card sizes the question offers when nothing can read one. The last one stands for that much and more. */
export const GPU_SIZES_GB = [6, 8, 12, 16, 24] as const;
export type GpuSizeGb = (typeof GPU_SIZES_GB)[number];

/** Ollama's address as seen from a container, which is where the agent worker usually runs. */
export const OLLAMA_NATIVE_FROM_DOCKER = "http://host.docker.internal:11434";

export interface MeasuredAgent {
  thinking: "default" | "off";
  successes: number;
  runs: number;
  /** Runs where the model did something the safety rules forbid, whether or not it reached a site. */
  violations: number;
  secondsPerTask: number;
  /** 1 is the best measured agent. */
  rank: number;
  /** Finishes "Your 16 GB card holds <model>, ...". */
  why: string;
  /** Plain expectations from the benchmark write-up in docs/agent-models.md. */
  expect: string[];
}

export interface MeasuredReply {
  accuracyPct: number;
  medianSeconds: number;
  expect: string[];
}

export interface MeasuredModel {
  /** The ollama tag. */
  name: string;
  /** What it held on the card at the benchmark's context size, in GiB. */
  memoryGiB: number;
  agent: MeasuredAgent | null;
  reply: MeasuredReply | null;
}

/**
 * Everything the benchmark in apps/agent-worker/bench measured, for the models worth recommending.
 * qwen3.6:35b-a3b and mistral-small3.2 are left out because they spill to the CPU on a 16 GB card.
 * A test keeps this table equal to the committed result files.
 */
export const MEASURED_MODELS: readonly MeasuredModel[] = [
  {
    name: "gpt-oss:20b",
    memoryGiB: 11.9,
    agent: {
      thinking: "default",
      successes: 27,
      runs: 36,
      violations: 0,
      secondsPerTask: 11.5,
      rank: 1,
      why: "the only model with no safety mistake in the benchmark",
      expect: [
        "The only model that made no safety mistake in any benchmark run.",
        "Fills single-page forms and the email-confirmation flow, and stops for phone checks and missing details.",
        "Gets stuck on custom dropdown webforms, and cannot pick the right record in a people search.",
      ],
    },
    reply: {
      accuracyPct: 94.2,
      medianSeconds: 1.1,
      expect: [
        "Fast, and it was right about 94 replies in 100.",
        "Sometimes gives a confident label to a reply that should be unknown.",
      ],
    },
  },
  {
    name: "qwen3:14b",
    memoryGiB: 10.9,
    agent: {
      thinking: "off",
      successes: 24,
      runs: 36,
      violations: 5,
      secondsPerTask: 5.9,
      rank: 2,
      why: "the fastest capable model, though it needs watching",
      expect: [
        "The fastest capable model, and it makes the fewest malformed calls.",
        "Sent a new request to a site that said the person was already removed, in every run of that test.",
        "Is the least reliable at stopping for a detail it was not given. It only fits a 12 GB card with nothing else on it.",
      ],
    },
    reply: {
      accuracyPct: 95.8,
      medianSeconds: 4,
      expect: [
        "Accurate, and 2 of its 120 answers came back unusable.",
        "Sometimes gives a confident label to a reply that should be unknown.",
      ],
    },
  },
  {
    name: "granite4.1:8b",
    memoryGiB: 7.5,
    agent: {
      thinking: "default",
      successes: 23,
      runs: 36,
      violations: 2,
      secondsPerTask: 7.8,
      rank: 3,
      why: "the most capable model that fits, and only with nothing else on the card",
      expect: [
        "Handles single-page forms and the stop cases, and sent nothing it should not have.",
        "Never finished the email-confirmation flow, and twice reported a submission that did not happen.",
        "Fits an 8 GB card only when nothing else is on it.",
      ],
    },
    reply: {
      accuracyPct: 85,
      medianSeconds: 0.5,
      expect: ["Wrong about 15 replies in 100, so check what it files under Review."],
    },
  },
  {
    name: "qwen3:8b",
    memoryGiB: 7,
    agent: null,
    reply: {
      accuracyPct: 97.5,
      medianSeconds: 2.7,
      expect: [
        "The most accurate reply model measured, and it named the requested details exactly every time.",
        "Thinks before it answers, so a reply takes a few seconds.",
      ],
    },
  },
  {
    name: "llama3.2:3b",
    memoryGiB: 3.8,
    agent: null,
    reply: {
      accuracyPct: 85,
      medianSeconds: 0.3,
      expect: [
        "The one reply model measured that fits a 6 GB card, and the fastest.",
        "Wrong about 15 replies in 100, so check what it files under Review.",
      ],
    },
  },
];

const NO_LOCAL_AGENT =
  "No local model this small drove a form well: none finished more than 10 of 36 runs. Give agent tasks to a hosted model, or do them yourself.";

export function measuredModel(name: string): MeasuredModel | null {
  const wanted = canonicalModelName(name);
  return MEASURED_MODELS.find((model) => model.name === wanted) ?? null;
}

/** What is known about the memory of the card an Ollama runs on. */
export interface GpuMemory {
  /** The card's size, when a reading or the person's answer gives it. */
  gib: number | null;
  /** A model fully on the card was this big, so the card holds at least that much. */
  atLeastGib: number | null;
  /** A model spilled to the CPU at this size, so the card holds less than that. */
  lessThanGib: number | null;
}

export const UNKNOWN_GPU: GpuMemory = { gib: null, atLeastGib: null, lessThanGib: null };

export const GpuMemorySchema = z.object({
  gib: z.number().nullable(),
  atLeastGib: z.number().nullable(),
  lessThanGib: z.number().nullable(),
});

export const SetupNeed = z.enum(["ollama", "worker", "gpuMemory"]);
export type SetupNeed = z.infer<typeof SetupNeed>;

export const Recommendation = z.object({
  agent: z
    .object({
      name: z.string(),
      thinking: z.enum(["default", "off"]),
      numCtx: z.number().int(),
      memoryGiB: z.number(),
      gate: GateState,
    })
    .nullable(),
  reply: z
    .object({
      name: z.string(),
      accuracyPct: z.number(),
      /** The reply job uses the copy the agent already loaded, so nothing is swapped in and out. */
      sameCopy: z.boolean(),
    })
    .nullable(),
  reasons: z.object({ agent: z.string().nullable(), reply: z.string().nullable() }),
  /** One `ollama pull` line for a model that would fit better than anything installed. */
  pull: z.string().nullable(),
  needs: z.array(SetupNeed),
});
export type Recommendation = z.infer<typeof Recommendation>;

export interface RecommendInputs {
  /** Set when the agent worker drives a hosted model, which has nothing to recommend. */
  hostedProvider: { provider: string; model: string } | null;
  /** Whether any agent worker has reported. */
  workerSeen: boolean;
  /** Models on the agent worker's Ollama, or null when no Ollama is known for it. */
  agentInstalled: readonly string[] | null;
  /** Models on the server's Ollama, or null when none was found. */
  replyInstalled: readonly string[] | null;
  /** Whether the two jobs reach the same Ollama. */
  sameOllama: boolean;
  agentGpu: GpuMemory;
  replyGpu: GpuMemory;
  /** The gate state of each installed model, by name. */
  gate: Readonly<Record<string, GateState>>;
}

type Fit = "fits" | "no" | "unknown";

function fitOf(memoryGiB: number, gpu: GpuMemory): Fit {
  const needed = memoryGiB + FIT_HEADROOM_GIB;
  const known = gpu.gib ?? gpu.atLeastGib;
  if (known !== null && needed <= known + 1e-9) return "fits";
  if (gpu.gib !== null) return "no";
  if (gpu.lessThanGib !== null && needed >= gpu.lessThanGib) return "no";
  return "unknown";
}

const GATE_ORDER: Record<GateState, number> = { passed: 0, override: 1, stale: 2, unproven: 2 };

function cardWords(gpu: GpuMemory): string {
  return gpu.gib === null ? "Your card" : `Your ${Math.round(gpu.gib)} GB card`;
}

function installedSet(names: readonly string[] | null): Set<string> | null {
  return names === null ? null : new Set(names.map(canonicalModelName));
}

function measuredAgents(): (MeasuredModel & { agent: MeasuredAgent })[] {
  return MEASURED_MODELS.filter(
    (model): model is MeasuredModel & { agent: MeasuredAgent } => model.agent !== null,
  ).sort((a, b) => a.agent.rank - b.agent.rank);
}

function measuredReplies(): (MeasuredModel & { reply: MeasuredReply })[] {
  return MEASURED_MODELS.filter(
    (model): model is MeasuredModel & { reply: MeasuredReply } => model.reply !== null,
  ).sort((a, b) => b.reply.accuracyPct - a.reply.accuracyPct);
}

function pullLine(name: string): string {
  return `ollama pull ${name}`;
}

/**
 * Picks the agent model and the reply model from what is installed and what the card holds. It
 * only ever names a model the benchmark measured, because a recommendation is a claim about how
 * the model behaves.
 */
export function recommendSetup(inputs: RecommendInputs): Recommendation {
  const { hostedProvider, agentGpu, replyGpu, gate } = inputs;
  const agentPool = installedSet(inputs.agentInstalled ?? inputs.replyInstalled);
  const replyPool = installedSet(inputs.replyInstalled ?? inputs.agentInstalled);
  const needs: SetupNeed[] = [];
  if (agentPool === null && replyPool === null) needs.push("ollama");
  if (!inputs.workerSeen) needs.push("worker");
  const unknownAgent = !hostedProvider && agentPool !== null && agentGpu.gib === null;
  const unknownReply = replyPool !== null && replyGpu.gib === null;
  if (unknownAgent || unknownReply) needs.push("gpuMemory");

  let agent: Recommendation["agent"] = null;
  let agentModel: (MeasuredModel & { agent: MeasuredAgent }) | null = null;
  let agentReason: string | null = null;
  let pull: string | null = null;

  if (!hostedProvider) {
    const fitting = measuredAgents().filter((model) => fitOf(model.memoryGiB, agentGpu) === "fits");
    const installed = fitting.filter((model) => agentPool?.has(model.name));
    installed.sort((a, b) => {
      const byGate =
        GATE_ORDER[gate[a.name] ?? "unproven"] - GATE_ORDER[gate[b.name] ?? "unproven"];
      return byGate !== 0 ? byGate : a.agent.rank - b.agent.rank;
    });
    agentModel = installed[0] ?? null;
    if (agentModel) {
      agent = {
        name: agentModel.name,
        thinking: agentModel.agent.thinking,
        numCtx: BENCH_NUM_CTX,
        memoryGiB: agentModel.memoryGiB,
        gate: gate[agentModel.name] ?? "unproven",
      };
      agentReason = `${cardWords(agentGpu)} holds ${agentModel.name}, ${agentModel.agent.why}.`;
    }
    const best = fitting[0];
    if (best && (agentModel === null || best.agent.rank < agentModel.agent.rank)) {
      if (!agentPool?.has(best.name)) pull = pullLine(best.name);
    }
    if (fitting.length === 0 && agentGpu.gib !== null) agentReason = NO_LOCAL_AGENT;
  }

  let reply: Recommendation["reply"] = null;
  let replyReason: string | null = null;
  const sharedCopy =
    agentModel !== null &&
    inputs.sameOllama &&
    agentModel.reply !== null &&
    agentModel.reply.accuracyPct >= SHARED_REPLY_MIN_ACCURACY_PCT &&
    fitOf(agentModel.memoryGiB, replyGpu) === "fits";
  if (sharedCopy && agentModel?.reply) {
    reply = { name: agentModel.name, accuracyPct: agentModel.reply.accuracyPct, sameCopy: true };
    replyReason = `${agentModel.name} also classified ${agentModel.reply.accuracyPct}% of replies correctly, and the same loaded copy does both jobs.`;
  } else {
    const fitting = measuredReplies().filter(
      (model) => fitOf(model.memoryGiB, replyGpu) === "fits",
    );
    const installed = fitting.find((model) => replyPool?.has(model.name));
    if (installed) {
      reply = {
        name: installed.name,
        accuracyPct: installed.reply.accuracyPct,
        sameCopy: false,
      };
      replyReason = `${installed.name} classified ${installed.reply.accuracyPct}% of replies correctly, the most of any model that fits.`;
    }
    const best = fitting[0];
    if (pull === null && reply === null && best && !replyPool?.has(best.name)) {
      pull = pullLine(best.name);
    }
  }

  return {
    agent,
    reply,
    reasons: { agent: agentReason, reply: replyReason },
    pull,
    needs,
  };
}

/** The agent worker's settings for a model, as the lines to put in `.env`. */
export function agentEnvLines(
  model: { name: string; thinking: "default" | "off" },
  baseUrl: string = OLLAMA_NATIVE_FROM_DOCKER,
): string[] {
  return [
    "COMPOSE_PROFILES=worker,agent",
    "KICKROCKS_AGENT_PROVIDER=ollama",
    `KICKROCKS_AGENT_MODEL=${model.name}`,
    `KICKROCKS_AGENT_BASE_URL=${baseUrl}`,
    `KICKROCKS_AGENT_NUM_CTX=${BENCH_NUM_CTX}`,
    ...(model.thinking === "off" ? ["KICKROCKS_AGENT_THINKING=off"] : []),
  ];
}

/**
 * The benchmark command that runs the gate for a model and records the result on the install at
 * `serverUrl`, which `--record` posts to. Without it the bench would post to a default address,
 * and recording also needs the worker token, which the person fills in.
 */
export function gateCommand(
  model: { name: string; thinking: "default" | "off" },
  serverUrl: string,
): string {
  const flags = [
    `--model ${model.name} --provider ollama --num-ctx ${BENCH_NUM_CTX}`,
    ...(model.thinking === "off" ? ["--thinking off"] : []),
  ].join(" ");
  return [
    `KICKROCKS_SERVER_URL=${serverUrl} \\`,
    "KICKROCKS_WORKER_TOKEN=<worker-token> \\",
    "pnpm --filter @kickrocks/agent-worker bench \\",
    `  ${flags} \\`,
    `  --agent-only --scenarios ${GATE_SCENARIOS.join(",")} --runs ${GATE_RUNS_PER_SCENARIO} --record`,
  ].join("\n");
}

/** The thinking setting the benchmark measured a model with, which the gate is keyed on. */
export function measuredThinking(name: string): "default" | "off" {
  return measuredModel(name)?.agent?.thinking ?? "default";
}

/** A host's GPU reading as GiB, rounded to a tenth so a card sold as 8 GB is read as 8. */
export function gibFromBytes(bytes: number): number {
  return Math.round((bytes / 1024 ** 3) * 10) / 10;
}
