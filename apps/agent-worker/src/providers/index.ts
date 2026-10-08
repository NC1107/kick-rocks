import type { ProviderConfig } from "../config.js";
import type { HttpOptions, ModelProvider } from "../provider.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOllamaProvider } from "./ollama.js";
import { createOpenAiProvider } from "./openai.js";

export function createProvider(
  config: ProviderConfig,
  http: Partial<HttpOptions> = {},
): ModelProvider {
  if (config.kind === "anthropic") {
    return createAnthropicProvider({
      ...http,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: config.apiKey ?? "",
    });
  }
  if (config.kind === "ollama") {
    return createOllamaProvider({
      ...http,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: config.apiKey,
      numCtx: config.numCtx,
      thinking: config.thinking,
    });
  }
  return createOpenAiProvider({
    ...http,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    tokenParam: config.tokenParam,
    thinking: config.thinking,
  });
}
