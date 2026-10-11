import { readFileSync } from "node:fs";
import { freemem } from "node:os";

/** What the model needs while loaded: the fp32 weights plus the runtime, measured at 780 to 850 MiB. */
export const MODEL_MEMORY_BYTES = 1.2 * 1024 ** 3;

function cgroupNumber(path: string): number | null {
  try {
    const raw = readFileSync(path, "utf8").trim();
    return raw === "max" ? null : Number(raw);
  } catch {
    return null;
  }
}

/**
 * Memory the server could still use: the machine's free memory, or what is left under the
 * container's limit when that is lower. Reading it fails open to the machine's figure.
 */
export function availableMemory(): number {
  const limit = cgroupNumber("/sys/fs/cgroup/memory.max");
  const used = cgroupNumber("/sys/fs/cgroup/memory.current");
  const machine = freemem();
  if (limit === null || used === null || Number.isNaN(limit) || Number.isNaN(used)) return machine;
  return Math.min(machine, Math.max(0, limit - used));
}
