import { spawn } from "node:child_process";

export interface VramSampler {
  /** Ends sampling and returns the highest use seen in MiB, or null when nvidia-smi gave nothing. */
  stop(): number | null;
}

/** Memory in use on the first GPU, or null on a machine without nvidia-smi. */
export function readVramMiB(): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "nvidia-smi",
      ["--query-gpu=memory.used", "--format=csv,noheader,nounits"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const value = Number(out.trim().split("\n")[0]);
      resolve(Number.isFinite(value) && out.trim() !== "" ? value : null);
    });
  });
}

/** Polls nvidia-smi until stopped, so the peak of a run is not missed between two readings. */
export function sampleVram(intervalMs = 250): VramSampler {
  let peak: number | null = null;
  let running = true;
  const loop = (async () => {
    while (running) {
      const used = await readVramMiB();
      if (used !== null) peak = Math.max(peak ?? 0, used);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  })();
  loop.catch(() => undefined);
  return {
    stop() {
      running = false;
      return peak;
    },
  };
}
