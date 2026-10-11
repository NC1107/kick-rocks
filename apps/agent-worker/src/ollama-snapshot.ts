import {
  MAX_OLLAMA_URL_LENGTH,
  type OllamaError,
  parseOllamaPs,
  parseOllamaTags,
  parseOllamaVersion,
  type WorkerOllama,
} from "@kickrocks/shared";
import { isColocated } from "./host.js";

/** A model server on the same machine answers at once, and a remote one on a LAN not much slower. */
const LOOKUP_TIMEOUT_MS = 3000;
/** Long enough that a claim loop does not ask every few seconds, short enough that a pull is noticed. */
const CACHE_MS = 30_000;

type Lookup = { ok: true; body: unknown } | { ok: false; error: OllamaError };

function withoutCredentials(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

async function lookup(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
): Promise<Lookup> {
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: "bad_response" };
    try {
      return { ok: true, body: await response.json() };
    } catch {
      return { ok: false, error: "bad_response" };
    }
  } catch (error) {
    const name = (error as { name?: unknown }).name;
    return {
      ok: false,
      error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreachable",
    };
  }
}

/**
 * The reading as the heartbeat may carry it, or null when its address is longer than the schema
 * allows. A refused inventory would reject the whole heartbeat, which is the liveness signal.
 */
export function inventoryOf(reading: WorkerOllama): WorkerOllama | null {
  return reading.baseUrl.length <= MAX_OLLAMA_URL_LENGTH ? reading : null;
}

export interface OllamaSnapshotSource {
  /** The latest reading, looked up again once the cache runs out. */
  get(): Promise<WorkerOllama>;
  /** Forgets the cached reading, such as after the person pulled a model. */
  invalidate(): void;
}

export interface OllamaSnapshotOptions {
  baseUrl: string;
  apiKey?: string | null;
  fetch?: typeof fetch;
  now?: () => number;
  /** The machine's own name, replaced in tests. */
  ownHostname?: string;
}

/** What the worker's own Ollama has installed and loaded, in one reading that every caller shares. */
export function createOllamaSnapshot(options: OllamaSnapshotOptions): OllamaSnapshotSource {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const baseUrl = options.baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  const headers: Record<string, string> = options.apiKey
    ? { authorization: `Bearer ${options.apiKey}` }
    : {};
  let cached: { at: number; reading: Promise<WorkerOllama> } | null = null;

  async function read(): Promise<WorkerOllama> {
    const [version, tags, running] = await Promise.all([
      lookup(fetchImpl, baseUrl, "/api/version", headers),
      lookup(fetchImpl, baseUrl, "/api/tags", headers),
      lookup(fetchImpl, baseUrl, "/api/ps", headers),
    ]);
    return {
      baseUrl: withoutCredentials(baseUrl),
      colocated: isColocated(baseUrl, options.ownHostname),
      reachable: tags.ok,
      error: tags.ok ? null : tags.error,
      version: version.ok ? parseOllamaVersion(version.body) : null,
      models: tags.ok ? parseOllamaTags(tags.body) : [],
      loaded: running.ok ? parseOllamaPs(running.body) : [],
      checkedAt: new Date(now()).toISOString(),
    };
  }

  return {
    get() {
      if (cached && now() - cached.at < CACHE_MS) return cached.reading;
      const reading = read();
      cached = { at: now(), reading };
      return reading;
    },
    invalidate() {
      cached = null;
    },
  };
}
