export interface LoadedModel {
  name?: string;
  model?: string;
  context_length?: number;
  size_vram?: number;
}

export interface OllamaStatus {
  contextLength: number | null;
  sizeVram: number | null;
}

/** Ollama lists a model pulled without a tag as `name:latest`, so both spellings name the same one. */
function canonical(name: string): string {
  return name.endsWith(":latest") ? name.slice(0, -":latest".length) : name;
}

export function findLoadedModel(
  loaded: readonly LoadedModel[],
  model: string,
): LoadedModel | undefined {
  const wanted = canonical(model);
  return loaded.find(
    (entry) =>
      (entry.name !== undefined && canonical(entry.name) === wanted) ||
      (entry.model !== undefined && canonical(entry.model) === wanted),
  );
}

function rootOf(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "");
}

/** What Ollama reports about the loaded model, which says whether the context was cut short. */
export async function ollamaStatus(baseUrl: string, model: string): Promise<OllamaStatus> {
  try {
    const response = await fetch(`${rootOf(baseUrl)}/api/ps`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = (await response.json()) as { models?: LoadedModel[] };
    const found = findLoadedModel(body.models ?? [], model);
    return { contextLength: found?.context_length ?? null, sizeVram: found?.size_vram ?? null };
  } catch {
    return { contextLength: null, sizeVram: null };
  }
}
