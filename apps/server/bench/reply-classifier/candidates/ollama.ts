export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";

export const DEFAULT_OLLAMA_MODEL = "granite4.1:8b";

/** Frees the GPU for whoever needs it next, instead of leaving the model to expire on its own. */
export async function unloadOllamaModel(
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchImpl(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, keep_alive: 0 }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // The model then unloads on Ollama's own timer, which is only slower.
  }
}

export async function ollamaHasModel(
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { models?: { name: string }[] };
    return (body.models ?? []).some((entry) => entry.name === model);
  } catch {
    return false;
  }
}
