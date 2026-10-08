import { describe, expect, it } from "vitest";
import { loadAgentWorkerConfig } from "./config.js";

const BASE = { KICKROCKS_WORKER_TOKEN: "a-token-of-sixteen-chars" };

describe("loadAgentWorkerConfig", () => {
  it("defaults to Ollama on its usual address and needs a model name", () => {
    expect(() => loadAgentWorkerConfig(BASE)).toThrow(/KICKROCKS_AGENT_MODEL/);
    const config = loadAgentWorkerConfig({ ...BASE, KICKROCKS_AGENT_MODEL: "qwen3:14b" });
    expect(config.provider).toEqual({
      kind: "openai",
      model: "qwen3:14b",
      baseUrl: "http://localhost:11434/v1",
      apiKey: null,
      maxOutputTokens: 4096,
      tokenParam: "max_tokens",
      numCtx: 16_384,
      thinking: "default",
    });
    expect(config.serverUrl).toBe("http://127.0.0.1:8420");
    expect(config.workerId).toMatch(/-agent$/);
  });

  it("takes any OpenAI-compatible endpoint, with a key and without a trailing slash", () => {
    const config = loadAgentWorkerConfig({
      ...BASE,
      KICKROCKS_AGENT_MODEL: "gpt-x",
      KICKROCKS_AGENT_BASE_URL: "https://llm.example.com/v1/",
      KICKROCKS_AGENT_API_KEY: "secret",
    });
    expect(config.provider).toMatchObject({
      baseUrl: "https://llm.example.com/v1",
      apiKey: "secret",
    });
  });

  it("takes the name of the output limit parameter from KICKROCKS_AGENT_TOKEN_PARAM", () => {
    const config = loadAgentWorkerConfig({
      ...BASE,
      KICKROCKS_AGENT_MODEL: "o4-mini",
      KICKROCKS_AGENT_TOKEN_PARAM: "max_completion_tokens",
    });
    expect(config.provider).toMatchObject({ tokenParam: "max_completion_tokens" });
    expect(() =>
      loadAgentWorkerConfig({
        ...BASE,
        KICKROCKS_AGENT_MODEL: "x",
        KICKROCKS_AGENT_TOKEN_PARAM: "n",
      }),
    ).toThrow();
  });

  it("gives a thinking model room by default, and lets thinking be turned off", () => {
    const env = { ...BASE, KICKROCKS_AGENT_MODEL: "qwen3:8b" };
    expect(loadAgentWorkerConfig(env).provider.maxOutputTokens).toBe(4096);
    expect(loadAgentWorkerConfig(env).provider.thinking).toBe("default");
    const off = loadAgentWorkerConfig({
      ...env,
      KICKROCKS_AGENT_THINKING: "off",
      KICKROCKS_AGENT_MAX_OUTPUT_TOKENS: "1024",
    });
    expect(off.provider).toMatchObject({ thinking: "off", maxOutputTokens: 1024 });
    expect(() => loadAgentWorkerConfig({ ...env, KICKROCKS_AGENT_THINKING: "low" })).toThrow();
  });

  describe("the ollama provider", () => {
    const env = {
      ...BASE,
      KICKROCKS_AGENT_PROVIDER: "ollama",
      KICKROCKS_AGENT_MODEL: "gpt-oss:20b",
    };

    it("talks to Ollama's native address with a context of 16384, so nobody gets the 4096 default", () => {
      expect(loadAgentWorkerConfig(env).provider).toEqual({
        kind: "ollama",
        model: "gpt-oss:20b",
        baseUrl: "http://localhost:11434",
        apiKey: null,
        maxOutputTokens: 4096,
        tokenParam: "max_tokens",
        numCtx: 16_384,
        thinking: "default",
      });
    });

    it("takes another context size, and refuses one too small to hold a page", () => {
      expect(
        loadAgentWorkerConfig({ ...env, KICKROCKS_AGENT_NUM_CTX: "32768" }).provider,
      ).toMatchObject({ numCtx: 32_768 });
      expect(() => loadAgentWorkerConfig({ ...env, KICKROCKS_AGENT_NUM_CTX: "1024" })).toThrow();
    });

    it("needs a model, and drops the /v1 that an openai address ends with", () => {
      expect(() => loadAgentWorkerConfig({ ...BASE, KICKROCKS_AGENT_PROVIDER: "ollama" })).toThrow(
        /ollama provider needs KICKROCKS_AGENT_MODEL/,
      );
      expect(
        loadAgentWorkerConfig({
          ...env,
          KICKROCKS_AGENT_BASE_URL: "http://host.docker.internal:11434/v1/",
        }).provider.baseUrl,
      ).toBe("http://host.docker.internal:11434");
    });

    it("leaves the openai provider on the /v1 address, for any compatible server", () => {
      expect(
        loadAgentWorkerConfig({ ...env, KICKROCKS_AGENT_PROVIDER: "openai" }).provider,
      ).toMatchObject({ kind: "openai", baseUrl: "http://localhost:11434/v1" });
    });
  });

  it("defaults Anthropic to claude-sonnet-4-6 and needs a key", () => {
    expect(() => loadAgentWorkerConfig({ ...BASE, KICKROCKS_AGENT_PROVIDER: "anthropic" })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    const config = loadAgentWorkerConfig({
      ...BASE,
      KICKROCKS_AGENT_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-test",
    });
    expect(config.provider).toMatchObject({
      kind: "anthropic",
      model: "claude-sonnet-4-6",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test",
    });
  });

  it("prefers the agent key over the Anthropic one, and an explicit model over the default", () => {
    const config = loadAgentWorkerConfig({
      ...BASE,
      KICKROCKS_AGENT_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-a",
      KICKROCKS_AGENT_API_KEY: "sk-b",
      KICKROCKS_AGENT_MODEL: "claude-haiku-4-5",
    });
    expect(config.provider).toMatchObject({ apiKey: "sk-b", model: "claude-haiku-4-5" });
  });

  it("reports cost only when both prices are set", () => {
    const env = { ...BASE, KICKROCKS_AGENT_MODEL: "m" };
    expect(loadAgentWorkerConfig(env).pricing).toBeNull();
    expect(
      loadAgentWorkerConfig({ ...env, KICKROCKS_AGENT_INPUT_USD_PER_MTOK: "3" }).pricing,
    ).toBeNull();
    expect(
      loadAgentWorkerConfig({
        ...env,
        KICKROCKS_AGENT_INPUT_USD_PER_MTOK: "3",
        KICKROCKS_AGENT_OUTPUT_USD_PER_MTOK: "15",
      }).pricing,
    ).toEqual({ inputUsdPerMtok: 3, outputUsdPerMtok: 15 });
  });

  it("sets the budgets, and bounds them", () => {
    const env = { ...BASE, KICKROCKS_AGENT_MODEL: "m" };
    expect(loadAgentWorkerConfig(env).limits).toEqual({
      maxSteps: 40,
      maxMs: 600_000,
      maxTotalTokens: null,
    });
    expect(
      loadAgentWorkerConfig({
        ...env,
        KICKROCKS_AGENT_MAX_STEPS: "12",
        KICKROCKS_AGENT_MAX_MINUTES: "2.5",
        KICKROCKS_AGENT_MAX_TOTAL_TOKENS: "50000",
      }).limits,
    ).toEqual({ maxSteps: 12, maxMs: 150_000, maxTotalTokens: 50_000 });
    expect(() => loadAgentWorkerConfig({ ...env, KICKROCKS_AGENT_MAX_STEPS: "0" })).toThrow();
    expect(() => loadAgentWorkerConfig({ ...env, KICKROCKS_AGENT_MAX_STEPS: "100000" })).toThrow();
  });

  it("treats empty variables as unset, which is how compose passes an absent value", () => {
    const config = loadAgentWorkerConfig({
      ...BASE,
      KICKROCKS_AGENT_MODEL: "m",
      KICKROCKS_AGENT_BASE_URL: "",
      KICKROCKS_AGENT_API_KEY: "",
      KICKROCKS_AGENT_MAX_STEPS: "",
    });
    expect(config.provider.baseUrl).toBe("http://localhost:11434/v1");
    expect(config.limits.maxSteps).toBe(40);
  });

  it("rejects a short worker token and a lease the server would refuse", () => {
    const env = { KICKROCKS_AGENT_MODEL: "m" };
    expect(() => loadAgentWorkerConfig({ ...env, KICKROCKS_WORKER_TOKEN: "short" })).toThrow();
    expect(() =>
      loadAgentWorkerConfig({ ...env, ...BASE, KICKROCKS_WORKER_LEASE_MS: "5" }),
    ).toThrow();
  });

  it("keeps its Chrome profile apart from the recipe worker's by default", () => {
    const config = loadAgentWorkerConfig({ ...BASE, KICKROCKS_AGENT_MODEL: "m" });
    expect(config.chromeProfileDir).toMatch(/\.chrome-profile-agent$/);
    expect(config.headless).toBe(false);
    expect(config.allowHttp).toBe(false);
    expect(config.pace).toBe("human");
  });
});
