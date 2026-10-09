import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

async function capture(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run(command, args, { timeout: 10_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export interface GpuState {
  name: string;
  usedMiB: number;
  totalMiB: number;
}

export async function gpuState(): Promise<GpuState | null> {
  const out = await capture("nvidia-smi", [
    "--query-gpu=name,memory.used,memory.total",
    "--format=csv,noheader,nounits",
  ]);
  const first = out?.split("\n")[0];
  if (!first) return null;
  const [name, used, total] = first.split(",").map((part) => part.trim());
  if (!name || !used || !total) return null;
  return { name, usedMiB: Number(used), totalMiB: Number(total) };
}

export function parseOllamaPs(output: string): string[] {
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name): name is string => Boolean(name));
}

/** The models Ollama holds in memory right now, whoever loaded them. */
export async function loadedOllamaModels(): Promise<string[]> {
  const out = await capture("ollama", ["ps"]);
  return out === null ? [] : parseOllamaPs(out);
}

export async function describeHardware(): Promise<string> {
  const gpu = await gpuState();
  const cpu = os.cpus()[0]?.model.trim() ?? "unknown CPU";
  const memoryGiB = Math.round(os.totalmem() / 1024 ** 3);
  const gpuText = gpu
    ? `${gpu.name} ${Math.round(gpu.totalMiB / 1024)} GiB`
    : "no NVIDIA GPU found";
  return `${cpu} (${os.cpus().length} threads), ${memoryGiB} GiB RAM, ${gpuText}`;
}

const POLL_MS = 15_000;

/**
 * The GPU is shared with other work, and a second model on it would distort both timings and run
 * the card out of memory. Waits until no model is loaded and at least `needMiB` of memory is free.
 */
export async function waitForIdleGpu(
  needMiB: number,
  log: (message: string) => void,
  maxWaitMs = 45 * 60_000,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  let announced = false;
  for (;;) {
    const [loaded, gpu] = await Promise.all([loadedOllamaModels(), gpuState()]);
    const free = gpu ? gpu.totalMiB - gpu.usedMiB : Number.POSITIVE_INFINITY;
    if (loaded.length === 0 && free >= needMiB) return;
    if (Date.now() > deadline) {
      throw new Error(
        `The GPU stayed busy (loaded: ${loaded.join(", ") || "none"}, free ${Math.round(free)} MiB)`,
      );
    }
    if (!announced) {
      log(
        `Waiting for the shared GPU: loaded ${loaded.join(", ") || "none"}, free ${Math.round(free)} MiB, need ${needMiB}`,
      );
      announced = true;
    }
    await sleep(POLL_MS);
  }
}
