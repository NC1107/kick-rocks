import {
  type AgentModelChoice,
  type AgentModelState,
  canonicalModelName,
  type WorkerOllama,
} from "@kickrocks/shared";
import type { ProviderConfig } from "./config.js";

export interface AgentModelDecision {
  state: AgentModelState;
  /** The provider to run with from now on, or null to keep the current one. */
  next: ProviderConfig | null;
}

/**
 * What to do with the model the person chose on the server. Only the model, its thinking setting
 * and its context come from the server: the address, the provider and the keys stay the
 * worker's own, so a server can never point the worker at another endpoint.
 */
export function decideAgentModel(
  own: ProviderConfig,
  choice: AgentModelChoice | null,
  ollama: WorkerOllama | null,
): AgentModelDecision {
  if (own.kind !== "ollama") return { state: "unsupported_provider", next: null };
  if (choice === null) return { state: "applied", next: own };
  const wanted = canonicalModelName(choice.name);
  const installed = ollama?.models.some((model) => canonicalModelName(model.name) === wanted);
  if (!installed) return { state: "not_installed", next: null };
  return {
    state: "applied",
    next: { ...own, model: choice.name, thinking: choice.thinking, numCtx: choice.numCtx },
  };
}

export function sameModelSettings(a: ProviderConfig, b: ProviderConfig): boolean {
  return a.model === b.model && a.thinking === b.thinking && a.numCtx === b.numCtx;
}
