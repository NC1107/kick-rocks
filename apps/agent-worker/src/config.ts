import { hostname } from "node:os";
import { resolve } from "node:path";
import { LEASE_MS, WebUrl } from "@kickrocks/shared";
import { z } from "zod";

/** Ollama's native address, for the ollama provider. */
const OLLAMA_NATIVE_URL = "http://localhost:11434";
/** The same server's OpenAI-compatible address, for the openai provider. */
export const OLLAMA_BASE_URL = `${OLLAMA_NATIVE_URL}/v1`;
/** Ollama's own default is 4096, which cuts an agent's conversation short without any error. */
const OLLAMA_DEFAULT_NUM_CTX = 16_384;
const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6";

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

  /**
   * `openai` is any OpenAI-compatible chat completions endpoint. `ollama` is Ollama's native API,
   * which is the one that sets the context size, so prefer it for Ollama.
   */
  KICKROCKS_AGENT_PROVIDER: z.enum(["openai", "ollama", "anthropic"]).default("openai"),
  KICKROCKS_AGENT_MODEL: z.string().min(1).optional(),
  KICKROCKS_AGENT_BASE_URL: WebUrl.optional(),
  /** Ollama needs none. Anthropic reads ANTHROPIC_API_KEY when this is unset. */
  KICKROCKS_AGENT_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** Per model turn. A thinking model spends much of it on thinking before its first tool call. */
  KICKROCKS_AGENT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32_000).default(4096),
  /** The ollama provider's context window in tokens. */
  KICKROCKS_AGENT_NUM_CTX: z.coerce
    .number()
    .int()
    .min(2048)
    .max(1_048_576)
    .default(OLLAMA_DEFAULT_NUM_CTX),
  /** `off` asks a model that can think not to, so its output cap goes to the answer. */
  KICKROCKS_AGENT_THINKING: z.enum(["default", "off"]).default("default"),
  /** What an OpenAI-compatible endpoint calls the output limit. OpenAI's reasoning models need max_completion_tokens. */
  KICKROCKS_AGENT_TOKEN_PARAM: z
    .enum(["max_tokens", "max_completion_tokens"])
    .default("max_tokens"),
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

/** Every variable the worker reads, so a packaging test can tell which ones compose must pass on. */
export const AGENT_ENV_KEYS: string[] = Object.keys(Env.shape);

export interface ProviderConfig {
  kind: "openai" | "ollama" | "anthropic";
  model: string;
  baseUrl: string;
  apiKey: string | null;
  maxOutputTokens: number;
  /** Only the openai provider reads this. */
  tokenParam: "max_tokens" | "max_completion_tokens";
  /** Only the ollama provider reads this. */
  numCtx: number;
  thinking: "default" | "off";
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

function sharedSettings(parsed: z.infer<typeof Env>) {
  return {
    maxOutputTokens: parsed.KICKROCKS_AGENT_MAX_OUTPUT_TOKENS,
    tokenParam: parsed.KICKROCKS_AGENT_TOKEN_PARAM,
    numCtx: parsed.KICKROCKS_AGENT_NUM_CTX,
    thinking: parsed.KICKROCKS_AGENT_THINKING,
  };
}

function providerFrom(parsed: z.infer<typeof Env>): ProviderConfig {
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
      ...sharedSettings(parsed),
    };
  }
  if (!parsed.KICKROCKS_AGENT_MODEL) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["KICKROCKS_AGENT_MODEL"],
        message: `The ${parsed.KICKROCKS_AGENT_PROVIDER} provider needs KICKROCKS_AGENT_MODEL, such as the name of an Ollama model that supports tools`,
        input: undefined,
      },
    ]);
  }
  if (parsed.KICKROCKS_AGENT_PROVIDER === "ollama") {
    return {
      kind: "ollama",
      model: parsed.KICKROCKS_AGENT_MODEL,
      // The native API has no /v1, but the address of the same server is easy to paste with one.
      baseUrl: (parsed.KICKROCKS_AGENT_BASE_URL ?? OLLAMA_NATIVE_URL)
        .replace(/\/+$/, "")
        .replace(/\/v1$/, ""),
      apiKey: parsed.KICKROCKS_AGENT_API_KEY ?? null,
      ...sharedSettings(parsed),
    };
  }
  return {
    kind: "openai",
    model: parsed.KICKROCKS_AGENT_MODEL,
    baseUrl: (parsed.KICKROCKS_AGENT_BASE_URL ?? OLLAMA_BASE_URL).replace(/\/+$/, ""),
    apiKey: parsed.KICKROCKS_AGENT_API_KEY ?? null,
    ...sharedSettings(parsed),
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
