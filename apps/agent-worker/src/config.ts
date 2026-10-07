import { hostname } from "node:os";
import { resolve } from "node:path";
import { LEASE_MS, WebUrl } from "@kickrocks/shared";
import { z } from "zod";

export const OLLAMA_BASE_URL = "http://localhost:11434/v1";
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6";

const Price = z.coerce.number().nonnegative();

const Env = z.object({
  KICKROCKS_SERVER_URL: WebUrl.default("http://127.0.0.1:8420"),
  KICKROCKS_WORKER_TOKEN: z
    .string()
    .min(16, "KICKROCKS_WORKER_TOKEN must be at least 16 characters"),
  KICKROCKS_WORKER_ID: z.string().min(1).max(100).default(`${hostname()}-agent`),
  KICKROCKS_WORKER_POLL_MS: z.coerce.number().int().min(500).default(5000),
  KICKROCKS_WORKER_LEASE_MS: z.coerce
    .number()
    .int()
    .min(LEASE_MS.min)
    .max(LEASE_MS.max)
    .default(LEASE_MS.default),

  /** `openai` is any OpenAI-compatible chat completions endpoint, which is what Ollama serves. */
  KICKROCKS_AGENT_PROVIDER: z.enum(["openai", "anthropic"]).default("openai"),
  KICKROCKS_AGENT_MODEL: z.string().min(1).optional(),
  KICKROCKS_AGENT_BASE_URL: WebUrl.optional(),
  /** Ollama needs none. Anthropic reads ANTHROPIC_API_KEY when this is unset. */
  KICKROCKS_AGENT_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  KICKROCKS_AGENT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32_000).default(2048),
  /** Prices per million tokens. Cost is only reported when both are set, because a guess would be wrong. */
  KICKROCKS_AGENT_INPUT_USD_PER_MTOK: Price.optional(),
  KICKROCKS_AGENT_OUTPUT_USD_PER_MTOK: Price.optional(),

  KICKROCKS_AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(500).default(40),
  KICKROCKS_AGENT_MAX_MINUTES: z.coerce.number().min(0.5).max(120).default(10),
  KICKROCKS_AGENT_MAX_TOTAL_TOKENS: z.coerce.number().int().min(1000).optional(),

  KICKROCKS_CHROME_PROFILE: z.string().default("./.chrome-profile-agent"),
  KICKROCKS_WORKER_HEADLESS: z.enum(["true", "false"]).default("false"),
  KICKROCKS_WORKER_NO_SANDBOX: z.enum(["true", "false"]).default("false"),
  KICKROCKS_WORKER_ALLOW_HTTP: z.enum(["true", "false"]).default("false"),
  KICKROCKS_WORKER_PACE: z.enum(["human", "instant"]).default("human"),
  KICKROCKS_CHROME_EXECUTABLE: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface ProviderConfig {
  kind: "openai" | "anthropic";
  model: string;
  baseUrl: string;
  apiKey: string | null;
  maxOutputTokens: number;
}

export interface Pricing {
  inputUsdPerMtok: number;
  outputUsdPerMtok: number;
}

export interface AgentLimits {
  maxSteps: number;
  maxMs: number;
  maxTotalTokens: number | null;
}

export interface AgentWorkerConfig {
  serverUrl: string;
  token: string;
  workerId: string;
  pollMs: number;
  leaseMs: number;
  provider: ProviderConfig;
  pricing: Pricing | null;
  limits: AgentLimits;
  chromeProfileDir: string;
  headless: boolean;
  noSandbox: boolean;
  allowHttp: boolean;
  pace: "human" | "instant";
  chromeExecutable: string | null;
  logLevel: z.infer<typeof Env>["LOG_LEVEL"];
}

/** Variables that are set but empty count as unset, which is how compose passes an absent value. */
function withoutEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
}

function providerFrom(parsed: z.infer<typeof Env>): ProviderConfig {
  const maxOutputTokens = parsed.KICKROCKS_AGENT_MAX_OUTPUT_TOKENS;
  if (parsed.KICKROCKS_AGENT_PROVIDER === "anthropic") {
    const apiKey = parsed.KICKROCKS_AGENT_API_KEY ?? parsed.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["ANTHROPIC_API_KEY"],
          message: "The anthropic provider needs ANTHROPIC_API_KEY or KICKROCKS_AGENT_API_KEY",
          input: undefined,
        },
      ]);
    }
    return {
      kind: "anthropic",
      model: parsed.KICKROCKS_AGENT_MODEL ?? ANTHROPIC_DEFAULT_MODEL,
      baseUrl: (parsed.KICKROCKS_AGENT_BASE_URL ?? ANTHROPIC_BASE_URL).replace(/\/+$/, ""),
      apiKey,
      maxOutputTokens,
    };
  }
  if (!parsed.KICKROCKS_AGENT_MODEL) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["KICKROCKS_AGENT_MODEL"],
        message:
          "The openai provider needs KICKROCKS_AGENT_MODEL, such as the name of an Ollama model that supports tools",
        input: undefined,
      },
    ]);
  }
  return {
    kind: "openai",
    model: parsed.KICKROCKS_AGENT_MODEL,
    baseUrl: (parsed.KICKROCKS_AGENT_BASE_URL ?? OLLAMA_BASE_URL).replace(/\/+$/, ""),
    apiKey: parsed.KICKROCKS_AGENT_API_KEY ?? null,
    maxOutputTokens,
  };
}

function pricingFrom(parsed: z.infer<typeof Env>): Pricing | null {
  const input = parsed.KICKROCKS_AGENT_INPUT_USD_PER_MTOK;
  const output = parsed.KICKROCKS_AGENT_OUTPUT_USD_PER_MTOK;
  if (input === undefined || output === undefined) return null;
  return { inputUsdPerMtok: input, outputUsdPerMtok: output };
}

export function loadAgentWorkerConfig(env: NodeJS.ProcessEnv = process.env): AgentWorkerConfig {
  const parsed = Env.parse(withoutEmpty(env));
  return {
    serverUrl: parsed.KICKROCKS_SERVER_URL.replace(/\/+$/, ""),
    token: parsed.KICKROCKS_WORKER_TOKEN,
    workerId: parsed.KICKROCKS_WORKER_ID,
    pollMs: parsed.KICKROCKS_WORKER_POLL_MS,
    leaseMs: parsed.KICKROCKS_WORKER_LEASE_MS,
    provider: providerFrom(parsed),
    pricing: pricingFrom(parsed),
    limits: {
      maxSteps: parsed.KICKROCKS_AGENT_MAX_STEPS,
      maxMs: Math.round(parsed.KICKROCKS_AGENT_MAX_MINUTES * 60_000),
      maxTotalTokens: parsed.KICKROCKS_AGENT_MAX_TOTAL_TOKENS ?? null,
    },
    chromeProfileDir: resolve(parsed.KICKROCKS_CHROME_PROFILE),
    headless: parsed.KICKROCKS_WORKER_HEADLESS === "true",
    noSandbox: parsed.KICKROCKS_WORKER_NO_SANDBOX === "true",
    allowHttp: parsed.KICKROCKS_WORKER_ALLOW_HTTP === "true",
    pace: parsed.KICKROCKS_WORKER_PACE,
    chromeExecutable: parsed.KICKROCKS_CHROME_EXECUTABLE
      ? resolve(parsed.KICKROCKS_CHROME_EXECUTABLE)
      : null,
    logLevel: parsed.LOG_LEVEL,
  };
}
