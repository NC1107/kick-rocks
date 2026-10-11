import {
  normalizeOllamaUrl,
  type OllamaLoaded,
  type OllamaModel,
  type ProbeError,
  type ProbeResult,
  type ProbeSource,
  parseOllamaPs,
  parseOllamaTags,
  parseOllamaVersion,
} from "@kickrocks/shared";

/** Each of the three lookups gets this long, and they run side by side. */
export const PROBE_TIMEOUT_MS = 1500;
/** A tags answer larger than this is not an Ollama's, or lists more than a person would read. */
export const PROBE_BODY_LIMIT_BYTES = 256 * 1024;

type Lookup = { ok: true; body: unknown } | { ok: false; error: ProbeError };

async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > PROBE_BODY_LIMIT_BYTES) return null;
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > PROBE_BODY_LIMIT_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
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
      // A redirect could carry the saved key to another host, and a real Ollama never redirects.
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) return { ok: false, error: "redirect" };
    if (!response.ok) return { ok: false, error: "bad_response" };
    const raw = await readCapped(response);
    if (raw === null) return { ok: false, error: "too_large" };
    try {
      return { ok: true, body: JSON.parse(raw) };
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

export interface ProbeRequest {
  baseUrl: string;
  source: ProbeSource;
  /** Only ever the saved endpoint's own key, and only for that endpoint. */
  apiKey?: string | null;
}

/** Asks one address what Ollama it runs, returning parsed fields and never a raw body. */
export async function probeOllama(
  fetchImpl: typeof fetch,
  request: ProbeRequest,
): Promise<ProbeResult> {
  const baseUrl = normalizeOllamaUrl(request.baseUrl) ?? request.baseUrl;
  const headers: Record<string, string> = request.apiKey
    ? { authorization: `Bearer ${request.apiKey}` }
    : {};
  const [version, tags, running] = await Promise.all([
    lookup(fetchImpl, baseUrl, "/api/version", headers),
    lookup(fetchImpl, baseUrl, "/api/tags", headers),
    lookup(fetchImpl, baseUrl, "/api/ps", headers),
  ]);
  const models: OllamaModel[] = tags.ok ? parseOllamaTags(tags.body) : [];
  const loaded: OllamaLoaded[] = running.ok ? parseOllamaPs(running.body) : [];
  return {
    baseUrl,
    source: request.source,
    reachable: tags.ok,
    error: tags.ok ? null : tags.error,
    version: version.ok ? parseOllamaVersion(version.body) : null,
    models,
    loaded,
  };
}
