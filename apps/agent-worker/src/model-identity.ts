import { canonicalModelName, type ModelIdentity, type WorkerOllama } from "@kickrocks/shared";
import type { ProviderConfig } from "./config.js";
import { createOllamaSnapshot, type OllamaSnapshotSource } from "./ollama-snapshot.js";

/** The digest ollama reports for the tag, which changes when a newer build is pulled under it. */
export function digestOf(snapshot: WorkerOllama | null, model: string): string | null {
  const wanted = canonicalModelName(model);
  const found = snapshot?.models.find((entry) => canonicalModelName(entry.name) === wanted);
  return found?.digest ? found.digest : null;
}

/**
 * Who this worker drives. Only ollama says which build a tag is, so the other providers have no
 * version, and a pass for them cannot go stale by itself.
 */
export function identityOf(provider: ProviderConfig, snapshot: WorkerOllama | null): ModelIdentity {
  return {
    provider: provider.kind,
    name: provider.model,
    version: provider.kind === "ollama" ? digestOf(snapshot, provider.model) : null,
    thinking: provider.thinking,
    numCtx: provider.kind === "ollama" ? provider.numCtx : null,
  };
}

/** For a caller that has no worker around it, such as the benchmark: one look, no cache. */
export async function describeModel(
  provider: ProviderConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelIdentity> {
  if (provider.kind !== "ollama") return identityOf(provider, null);
  const snapshots = createOllamaSnapshot({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    fetch: fetchImpl,
  });
  return identityOf(provider, await snapshots.get());
}

/**
 * The identity, read from the shared Ollama snapshot each time it is asked for, so a model pulled
 * while the worker runs is noticed once the snapshot's cache runs out.
 */
export function modelIdentitySource(
  provider: ProviderConfig,
  snapshots: OllamaSnapshotSource | null,
): () => Promise<ModelIdentity> {
  return async () =>
    identityOf(provider, provider.kind === "ollama" && snapshots ? await snapshots.get() : null);
}
