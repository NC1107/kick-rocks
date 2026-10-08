import { GATE_RUNS_PER_SCENARIO, GATE_SCENARIOS } from "./agent-models.js";

/** Card sizes the presets cover. The last one stands for that much and more. */
export const GPU_SIZES_GB = [6, 8, 12, 16, 24] as const;
export type GpuSizeGb = (typeof GPU_SIZES_GB)[number];

export const DEFAULT_GPU_SIZE_GB: GpuSizeGb = 16;

/** ollama's address as seen from a container, which is where the server and the agent worker usually run. */
export const OLLAMA_NATIVE_FROM_DOCKER = "http://host.docker.internal:11434";
export const OLLAMA_OPENAI_FROM_DOCKER = `${OLLAMA_NATIVE_FROM_DOCKER}/v1`;
export const BENCH_NUM_CTX = 16_384;

export interface AgentPreset {
  /** The ollama tag. */
  model: string;
  thinking: "default" | "off";
  /** What the bench measured, in the words a person would use. */
  facts: { label: string; value: string }[];
  /** Plain expectations from the benchmark write-up in docs/agent-models.md. */
  expect: string[];
}

export interface ReplyPreset {
  model: string;
  facts: { label: string; value: string }[];
  expect: string[];
}

export interface ModelPreset {
  gpuGb: GpuSizeGb;
  label: string;
  /** Null when no local model measured well enough to drive a form on this much memory. */
  agent: AgentPreset | null;
  reply: ReplyPreset;
  /** Why there is no agent model, or what to do instead. */
  agentFallback: string | null;
}

const GPT_OSS: AgentPreset = {
  model: "gpt-oss:20b",
  thinking: "default",
  facts: [
    { label: "Finished", value: "27 of 36 runs" },
    { label: "Memory", value: "11.9 GiB" },
    { label: "Time per task", value: "11.5 s" },
  ],
  expect: [
    "The only model that made no safety mistake in any benchmark run.",
    "Fills single-page forms and the email-confirmation flow, and stops for phone checks and missing details.",
    "Gets stuck on custom dropdown webforms, and cannot pick the right record in a people search.",
  ],
};

const QWEN3_14B: AgentPreset = {
  model: "qwen3:14b",
  thinking: "off",
  facts: [
    { label: "Finished", value: "24 of 36 runs" },
    { label: "Memory", value: "10.9 GiB" },
    { label: "Time per task", value: "5.9 s" },
  ],
  expect: [
    "The fastest capable model, and it makes the fewest malformed calls.",
    "Sent a new request to a site that said the person was already removed, in every run of that test.",
    "Is the least reliable at stopping for a detail it was not given. It only fits a 12 GB card with nothing else on it.",
  ],
};

const GRANITE_8B: AgentPreset = {
  model: "granite4.1:8b",
  thinking: "default",
  facts: [
    { label: "Finished", value: "23 of 36 runs" },
    { label: "Memory", value: "7.5 GiB" },
    { label: "Time per task", value: "7.8 s" },
  ],
  expect: [
    "Handles single-page forms and the stop cases, and sent nothing it should not have.",
    "Never finished the email-confirmation flow, and twice reported a submission that did not happen.",
    "Fits an 8 GB card only when nothing else is on it.",
  ],
};

const QWEN3_8B_REPLY: ReplyPreset = {
  model: "qwen3:8b",
  facts: [
    { label: "Accuracy", value: "97.5%" },
    { label: "Median time", value: "2.7 s" },
  ],
  expect: [
    "The most accurate reply model measured, and it named the requested details exactly every time.",
    "Thinks before it answers, so a reply takes a few seconds.",
  ],
};

const QWEN3_14B_REPLY: ReplyPreset = {
  model: "qwen3:14b",
  facts: [
    { label: "Accuracy", value: "95.8%" },
    { label: "Median time", value: "3.9 s" },
  ],
  expect: [
    "Accurate, and 2 of its 120 answers came back unusable.",
    "Sometimes gives a confident label to a reply that should be unknown.",
  ],
};

const GPT_OSS_REPLY: ReplyPreset = {
  model: "gpt-oss:20b",
  facts: [
    { label: "Accuracy", value: "94.2%" },
    { label: "Median time", value: "1.1 s" },
  ],
  expect: [
    "Fast, and it was right about 94 replies in 100.",
    "Sometimes gives a confident label to a reply that should be unknown.",
  ],
};

const LLAMA_3B_REPLY: ReplyPreset = {
  model: "llama3.2:3b",
  facts: [
    { label: "Accuracy", value: "85.0%" },
    { label: "Median time", value: "0.3 s" },
  ],
  expect: [
    "The one reply model measured that fits a 6 GB card, and the fastest.",
    "Wrong about 15 replies in 100, so check what it files under Review.",
  ],
};

export const MODEL_PRESETS: readonly ModelPreset[] = [
  {
    gpuGb: 6,
    label: "6 GB",
    agent: null,
    agentFallback:
      "No local model this small drove a form well: none finished more than 10 of 36 runs. Give agent tasks to a hosted model, or do them yourself.",
    reply: LLAMA_3B_REPLY,
  },
  {
    gpuGb: 8,
    label: "8 GB",
    agent: GRANITE_8B,
    agentFallback: null,
    reply: QWEN3_8B_REPLY,
  },
  {
    gpuGb: 12,
    label: "12 GB",
    agent: QWEN3_14B,
    agentFallback: null,
    reply: QWEN3_14B_REPLY,
  },
  {
    gpuGb: 16,
    label: "16 GB",
    agent: GPT_OSS,
    agentFallback: null,
    reply: GPT_OSS_REPLY,
  },
  {
    gpuGb: 24,
    label: "24 GB and up",
    agent: GPT_OSS,
    agentFallback: null,
    reply: GPT_OSS_REPLY,
  },
];

export function presetFor(gpuGb: number): ModelPreset {
  const fits = MODEL_PRESETS.filter((preset) => preset.gpuGb <= gpuGb);
  return fits[fits.length - 1] ?? (MODEL_PRESETS[0] as ModelPreset);
}

/** The agent worker's settings for a preset, as the lines to put in `.env`. */
export function agentEnvLines(agent: AgentPreset): string[] {
  return [
    "COMPOSE_PROFILES=worker,agent",
    "KICKROCKS_AGENT_PROVIDER=ollama",
    `KICKROCKS_AGENT_MODEL=${agent.model}`,
    `KICKROCKS_AGENT_BASE_URL=${OLLAMA_NATIVE_FROM_DOCKER}`,
    `KICKROCKS_AGENT_NUM_CTX=${BENCH_NUM_CTX}`,
    ...(agent.thinking === "off" ? ["KICKROCKS_AGENT_THINKING=off"] : []),
  ];
}

/** The benchmark command that runs the gate for a preset and records the result on this install. */
export function gateCommand(agent: AgentPreset): string {
  return [
    "pnpm --filter @kickrocks/agent-worker bench",
    `--model ${agent.model} --provider ollama --num-ctx ${BENCH_NUM_CTX}`,
    ...(agent.thinking === "off" ? ["--thinking off"] : []),
    `--agent-only --scenarios ${GATE_SCENARIOS.join(",")} --runs ${GATE_RUNS_PER_SCENARIO}`,
    "--record",
  ].join(" ");
}
