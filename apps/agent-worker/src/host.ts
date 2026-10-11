import { execFile } from "node:child_process";
import { arch, cpus, hostname, platform, totalmem } from "node:os";
import { MAX_HOST_GPUS, type WorkerGpu, type WorkerHost } from "@kickrocks/shared";

const PROBE_TIMEOUT_MS = 5000;
const MAX_OUTPUT_BYTES = 1_000_000;
const MIB = 1024 * 1024;

/** Runs a program and resolves with its output, or rejects with the spawn error (`code` is ENOENT when it is missing). */
export type Exec = (file: string, args: readonly string[], timeoutMs: number) => Promise<string>;

export const runProgram: Exec = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

type Attempt = { kind: "ok"; gpus: WorkerGpu[] } | { kind: "missing" } | { kind: "failed" };

/** `name, memory.total` per line, with the memory in MiB. The name may hold a comma, the memory never does. */
export function parseNvidiaSmi(output: string): WorkerGpu[] {
  const gpus: WorkerGpu[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const split = trimmed.lastIndexOf(",");
    if (split < 0) continue;
    const mebibytes = Number(trimmed.slice(split + 1).trim());
    if (!Number.isFinite(mebibytes) || mebibytes <= 0) continue;
    gpus.push({
      vendor: "nvidia",
      name: trimmed.slice(0, split).trim().slice(0, 200),
      memoryBytes: Math.round(mebibytes * MIB),
    });
  }
  return gpus;
}

/** rocm-smi keys each card as `card0`, `card1` and so on, with the memory in bytes. */
export function parseRocmSmi(output: string): WorkerGpu[] {
  const parsed: unknown = JSON.parse(output);
  if (typeof parsed !== "object" || parsed === null) return [];
  const gpus: WorkerGpu[] = [];
  for (const [key, card] of Object.entries(parsed)) {
    if (!/^card\d+$/.test(key) || typeof card !== "object" || card === null) continue;
    const fields = card as Record<string, unknown>;
    const bytes = Number(fields["VRAM Total Memory (B)"]);
    if (!Number.isFinite(bytes) || bytes <= 0) continue;
    const name = [fields["Card Series"], fields["Card model"], fields["Card SKU"]].find(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    );
    gpus.push({
      vendor: "amd",
      name: (name ?? "AMD GPU").trim().slice(0, 200),
      memoryBytes: bytes,
    });
  }
  return gpus;
}

async function attempt(
  exec: Exec,
  file: string,
  args: readonly string[],
  parse: (output: string) => WorkerGpu[],
): Promise<Attempt> {
  try {
    return { kind: "ok", gpus: parse(await exec(file, args, PROBE_TIMEOUT_MS)) };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return code === "ENOENT" ? { kind: "missing" } : { kind: "failed" };
  }
}

/** Keeps the cards the heartbeat can carry, and the largest are the ones a recommendation needs. */
function largestFirst(gpus: WorkerGpu[]): WorkerGpu[] {
  return [...gpus].sort((a, b) => b.memoryBytes - a.memoryBytes).slice(0, MAX_HOST_GPUS);
}

/** The cards the machine shows, or why it could not tell. `null` cards mean the probe did not run to the end. */
export async function probeGpus(
  exec: Exec = runProgram,
): Promise<Pick<WorkerHost, "gpus" | "gpuProbe">> {
  const nvidia = await attempt(
    exec,
    "nvidia-smi",
    ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
    parseNvidiaSmi,
  );
  if (nvidia.kind === "ok") return { gpus: largestFirst(nvidia.gpus), gpuProbe: "ok" };
  const rocm = await attempt(
    exec,
    "rocm-smi",
    ["--showproductname", "--showmeminfo", "vram", "--json"],
    parseRocmSmi,
  );
  if (rocm.kind === "ok") return { gpus: largestFirst(rocm.gpus), gpuProbe: "ok" };
  const missing = nvidia.kind === "missing" && rocm.kind === "missing";
  return { gpus: null, gpuProbe: missing ? "no_tool" : "failed" };
}

export interface HostSystem {
  hostname(): string;
  platform(): string;
  arch(): string;
  cpuCores(): number;
  totalMemory(): number;
}

const systemOs: HostSystem = {
  hostname,
  platform,
  arch,
  cpuCores: () => cpus().length,
  totalMemory: totalmem,
};

export async function collectHost(
  options: { exec?: Exec; system?: HostSystem } = {},
): Promise<WorkerHost> {
  const system = options.system ?? systemOs;
  return {
    hostname: system.hostname().slice(0, 200),
    platform: system.platform(),
    arch: system.arch(),
    cpuCores: system.cpuCores(),
    memoryBytes: system.totalMemory(),
    ...(await probeGpus(options.exec)),
  };
}

/** What a container calls the machine it runs on. */
const OWN_MACHINE_NAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
  "host.docker.internal",
  "gateway.docker.internal",
  "host-gateway",
  "host.containers.internal",
  "172.17.0.1",
]);

/**
 * Whether an Ollama address is on the machine the worker runs on, which is the only case where
 * the worker's own GPU reading says anything about that Ollama.
 */
export function isColocated(baseUrl: string, ownHostname: string = hostname()): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return OWN_MACHINE_NAMES.has(host) || /^127\./.test(host) || host === ownHostname.toLowerCase();
}
