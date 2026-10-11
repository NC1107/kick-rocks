import { z } from "zod";

/** The most models one inventory lists, so a heartbeat cannot grow without bound. */
export const MAX_INVENTORY_MODELS = 200;

export const GpuProbe = z.enum(["ok", "no_tool", "failed"]);
export type GpuProbe = z.infer<typeof GpuProbe>;

export const WorkerGpu = z.object({
  vendor: z.enum(["nvidia", "amd"]),
  name: z.string().max(200),
  memoryBytes: z.number().int().nonnegative(),
});
export type WorkerGpu = z.infer<typeof WorkerGpu>;

/** What the machine the agent worker runs on has. The server never runs a model, so it reports none of this. */
export const WorkerHost = z.object({
  hostname: z.string().max(200),
  platform: z.string().max(50),
  arch: z.string().max(50),
  cpuCores: z.number().int().nonnegative(),
  memoryBytes: z.number().int().nonnegative(),
  /** An empty list means the probe ran and found no card; null means it did not run. */
  gpus: z.array(WorkerGpu).max(16).nullable(),
  gpuProbe: GpuProbe,
});
export type WorkerHost = z.infer<typeof WorkerHost>;

export const OllamaModel = z.object({
  name: z.string().max(200),
  digest: z.string().max(200),
  sizeBytes: z.number().nonnegative(),
  parameterSize: z.string().max(50).nullable(),
  quantization: z.string().max(50).nullable(),
});
export type OllamaModel = z.infer<typeof OllamaModel>;

export const OllamaLoaded = z.object({
  name: z.string().max(200),
  sizeBytes: z.number().nonnegative(),
  sizeVramBytes: z.number().nonnegative(),
  contextLength: z.number().int().nonnegative().nullable(),
});
export type OllamaLoaded = z.infer<typeof OllamaLoaded>;

export const OllamaError = z.enum(["unreachable", "timeout", "bad_response"]);
export type OllamaError = z.infer<typeof OllamaError>;

/** What the agent worker's own Ollama reported. */
export const WorkerOllama = z.object({
  /** Without credentials. */
  baseUrl: z.string().max(500),
  /** Whether Ollama runs on the worker's own machine, which decides if the worker's GPU is Ollama's. */
  colocated: z.boolean(),
  reachable: z.boolean(),
  error: OllamaError.nullable(),
  version: z.string().max(100).nullable(),
  models: z.array(OllamaModel).max(MAX_INVENTORY_MODELS),
  loaded: z.array(OllamaLoaded).max(MAX_INVENTORY_MODELS),
  checkedAt: z.iso.datetime(),
});
export type WorkerOllama = z.infer<typeof WorkerOllama>;

export const WORKER_ACCEPTS = ["agentModel"] as const;
export const WorkerAccepts = z.enum(WORKER_ACCEPTS);
export type WorkerAccepts = z.infer<typeof WorkerAccepts>;

export const AGENT_NUM_CTX = { min: 2048, max: 131_072 } as const;

/** The model the person chose for the agent worker. The address, provider and keys stay the worker's own. */
export const AgentModelChoice = z.object({
  name: z.string().min(1).max(200),
  thinking: z.enum(["default", "off"]),
  numCtx: z.number().int().min(AGENT_NUM_CTX.min).max(AGENT_NUM_CTX.max),
});
export type AgentModelChoice = z.infer<typeof AgentModelChoice>;

export const AgentModelState = z.enum(["applied", "not_installed", "unsupported_provider"]);
export type AgentModelState = z.infer<typeof AgentModelState>;

/** Ollama lists a model pulled without a tag as `name:latest`, so both spellings name the same one. */
export function canonicalModelName(name: string): string {
  return name.endsWith(":latest") ? name.slice(0, -":latest".length) : name;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max = 200): string | null {
  return typeof value === "string" && value !== "" ? value.slice(0, max) : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function modelEntries(body: unknown): unknown[] {
  const list = record(body).models;
  return Array.isArray(list) ? list : [];
}

/** The installed models in an `/api/tags` answer, keeping only the fields the setup screen uses. */
export function parseOllamaTags(body: unknown): OllamaModel[] {
  const models: OllamaModel[] = [];
  for (const entry of modelEntries(body)) {
    const fields = record(entry);
    const name = text(fields.name);
    if (!name) continue;
    const details = record(fields.details);
    models.push({
      name,
      digest: text(fields.digest) ?? "",
      sizeBytes: count(fields.size),
      parameterSize: text(details.parameter_size, 50),
      quantization: text(details.quantization_level, 50),
    });
    if (models.length === MAX_INVENTORY_MODELS) break;
  }
  return models;
}

/** The loaded models in an `/api/ps` answer. */
export function parseOllamaPs(body: unknown): OllamaLoaded[] {
  const loaded: OllamaLoaded[] = [];
  for (const entry of modelEntries(body)) {
    const fields = record(entry);
    const name = text(fields.name);
    if (!name) continue;
    const context = count(fields.context_length);
    loaded.push({
      name,
      sizeBytes: count(fields.size),
      sizeVramBytes: count(fields.size_vram),
      contextLength: context > 0 ? Math.round(context) : null,
    });
    if (loaded.length === MAX_INVENTORY_MODELS) break;
  }
  return loaded;
}

export function parseOllamaVersion(body: unknown): string | null {
  return text(record(body).version, 100);
}
