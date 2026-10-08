import type { ModelIdentity } from "@kickrocks/shared";
import type { ProviderConfig } from "./config.js";

/** A model server on the same machine answers at once, so a short wait is enough. */
const LOOKUP_TIMEOUT_MS = 3000;
/** Long enough that a claim loop does not ask every few seconds, short enough that a pull is noticed. */
const CACHE_MS = 30_000;

/** Ollama lists a model pulled without a tag as `name:latest`, so both spellings name the same one. */
function canonical(name: string): string {
  return name.endsWith(":latest") ? name.slice(0, -":latest".length) : name;
}

/** The digest ollama reports for the tag, which changes when a newer build is pulled under it. */
export async function ollamaDigest(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/v1\/?$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { models?: { name?: string; digest?: string }[] };
    const wanted = canonical(model);
    const found = body.models?.find((entry) => entry.name && canonical(entry.name) === wanted);
    return found?.digest ? found.digest : null;
  } catch {
    return null;
  }
}

/**
 * Who this worker drives. Only ollama says which build a tag is, so the other providers have no
 * version, and a pass for them cannot go stale by itself.
 */
export async function describeModel(
  provider: ProviderConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelIdentity> {
  return {
    provider: provider.kind,
    name: provider.model,
    version:
      provider.kind === "ollama"
        ? await ollamaDigest(provider.baseUrl, provider.model, fetchImpl)
        : null,
    thinking: provider.thinking,
    numCtx: provider.kind === "ollama" ? provider.numCtx : null,
  };
}

/** The identity, looked up again once its cache runs out, so a model pulled while the worker runs is noticed. */
export function modelIdentitySource(
  provider: ProviderConfig,
  options: { fetch?: typeof fetch; now?: () => number } = {},
): () => Promise<ModelIdentity> {
  const now = options.now ?? Date.now;
  let cached: { at: number; identity: ModelIdentity } | null = null;
  return async () => {
    if (cached && now() - cached.at < CACHE_MS) return cached.identity;
    const identity = await describeModel(provider, options.fetch);
    cached = { at: now(), identity };
    return identity;
  };
}
