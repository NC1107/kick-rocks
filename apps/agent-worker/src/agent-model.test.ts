import type { WorkerOllama } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { decideAgentModel, sameModelSettings } from "./agent-model.js";
import type { ProviderConfig } from "./config.js";

const OWN: ProviderConfig = {
  kind: "ollama",
  model: "qwen3:8b",
  baseUrl: "http://localhost:11434",
  apiKey: "key",
  maxOutputTokens: 4096,
  tokenParam: "max_tokens",
  numCtx: 8192,
  thinking: "default",
};

const ollama = (...names: string[]): WorkerOllama => ({
  baseUrl: "http://localhost:11434",
  colocated: true,
  reachable: true,
  error: null,
  version: "0.12.0",
  models: names.map((name) => ({
    name,
    digest: "d",
    sizeBytes: 1,
    parameterSize: null,
    quantization: null,
  })),
  loaded: [],
  checkedAt: "2026-10-09T12:00:00.000Z",
});

const choice = { name: "gpt-oss:20b", thinking: "off" as const, numCtx: 16_384 };

describe("deciding what to do with the model the server offers", () => {
  it("takes the model, its thinking and its context, and nothing else", () => {
    const decision = decideAgentModel(OWN, choice, ollama("gpt-oss:20b"));
    expect(decision.state).toBe("applied");
    expect(decision.next).toEqual({
      ...OWN,
      model: "gpt-oss:20b",
      thinking: "off",
      numCtx: 16_384,
    });
    expect(decision.next?.baseUrl).toBe(OWN.baseUrl);
    expect(decision.next?.apiKey).toBe("key");
  });

  it("reads gpt-oss:20b and gpt-oss:20b:latest as the same install", () => {
    expect(
      decideAgentModel(OWN, { ...choice, name: "llama3.2" }, ollama("llama3.2:latest")).state,
    ).toBe("applied");
  });

  it("refuses a model that is not installed, and keeps what it has", () => {
    expect(decideAgentModel(OWN, choice, ollama("qwen3:8b"))).toEqual({
      state: "not_installed",
      next: null,
    });
    expect(decideAgentModel(OWN, choice, null).state).toBe("not_installed");
  });

  it.each(["openai", "anthropic"] as const)("never takes a model for the %s provider", (kind) => {
    expect(decideAgentModel({ ...OWN, kind }, choice, ollama("gpt-oss:20b"))).toEqual({
      state: "unsupported_provider",
      next: null,
    });
  });

  it("goes back to its own setting when the server has no choice", () => {
    expect(decideAgentModel(OWN, null, null).next).toBe(OWN);
  });

  it("compares the settings that change how a model behaves", () => {
    expect(sameModelSettings(OWN, { ...OWN })).toBe(true);
    expect(sameModelSettings(OWN, { ...OWN, numCtx: 16_384 })).toBe(false);
    expect(sameModelSettings(OWN, { ...OWN, thinking: "off" })).toBe(false);
  });
});
