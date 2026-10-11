import { describe, expect, it } from "vitest";
import {
  collectHost,
  type Exec,
  type HostSystem,
  isColocated,
  parseNvidiaSmi,
  parseRocmSmi,
  probeGpus,
} from "./host.js";

const missing = (): Error => Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });

/** Answers per program name; a function throws, a string is the output. */
function programs(table: Record<string, string | (() => never)>): Exec {
  return async (file) => {
    const answer = table[file];
    if (answer === undefined) throw missing();
    if (typeof answer === "function") return answer();
    return answer;
  };
}

describe("reading the GPUs from nvidia-smi", () => {
  it("lists every card with its memory in bytes", () => {
    expect(
      parseNvidiaSmi("NVIDIA GeForce RTX 5080, 16303\nNVIDIA GeForce GTX 1660, 6144\n"),
    ).toEqual([
      { vendor: "nvidia", name: "NVIDIA GeForce RTX 5080", memoryBytes: 16303 * 1024 * 1024 },
      { vendor: "nvidia", name: "NVIDIA GeForce GTX 1660", memoryBytes: 6144 * 1024 * 1024 },
    ]);
  });

  it("keeps a comma in a name and skips lines it cannot read", () => {
    expect(parseNvidiaSmi("Tesla T4, 16G, 15360\nnot a card\n\n")).toEqual([
      { vendor: "nvidia", name: "Tesla T4, 16G", memoryBytes: 15360 * 1024 * 1024 },
    ]);
  });
});

describe("reading the GPUs from rocm-smi", () => {
  it("reads the product name and total memory of each card", () => {
    const json = JSON.stringify({
      card0: { "Card Series": "Radeon RX 7900 XTX", "VRAM Total Memory (B)": "25753026560" },
      card1: { "Card model": "0x744c", "VRAM Total Memory (B)": "17163091968" },
      system: { "Driver version": "6.8" },
    });
    expect(parseRocmSmi(json)).toEqual([
      { vendor: "amd", name: "Radeon RX 7900 XTX", memoryBytes: 25_753_026_560 },
      { vendor: "amd", name: "0x744c", memoryBytes: 17_163_091_968 },
    ]);
  });
});

describe("probing for GPUs", () => {
  it("reports ok with the cards when nvidia-smi answers", async () => {
    const result = await probeGpus(programs({ "nvidia-smi": "RTX 5080, 16303\n" }));
    expect(result.gpuProbe).toBe("ok");
    expect(result.gpus).toHaveLength(1);
  });

  it("falls back to rocm-smi when nvidia-smi is not installed", async () => {
    const result = await probeGpus(
      programs({
        "rocm-smi": '{"card0":{"Card Series":"RX","VRAM Total Memory (B)":"8589934592"}}',
      }),
    );
    expect(result).toMatchObject({ gpuProbe: "ok", gpus: [{ vendor: "amd" }] });
  });

  it("says there is no tool, rather than no card, when neither program exists", async () => {
    expect(await probeGpus(programs({}))).toEqual({ gpus: null, gpuProbe: "no_tool" });
  });

  it("says ok with an empty list when the tool ran and found no card", async () => {
    expect(await probeGpus(programs({ "nvidia-smi": "\n" }))).toEqual({ gpus: [], gpuProbe: "ok" });
  });

  it("says failed when a tool exists but errors or times out", async () => {
    const timedOut = (): never => {
      throw Object.assign(new Error("timed out"), { killed: true, code: null });
    };
    expect(await probeGpus(programs({ "nvidia-smi": timedOut }))).toEqual({
      gpus: null,
      gpuProbe: "failed",
    });
    const brokenRocm = programs({ "rocm-smi": "not json" });
    expect((await probeGpus(brokenRocm)).gpuProbe).toBe("failed");
  });
});

describe("the host", () => {
  it("reports the machine and its cards together", async () => {
    const system: HostSystem = {
      hostname: () => "nick-desktop",
      platform: () => "linux",
      arch: () => "x64",
      cpuCores: () => 16,
      totalMemory: () => 64 * 1024 ** 3,
    };
    const host = await collectHost({ system, exec: programs({ "nvidia-smi": "RTX 5080, 16303" }) });
    expect(host).toMatchObject({
      hostname: "nick-desktop",
      platform: "linux",
      arch: "x64",
      cpuCores: 16,
      memoryBytes: 64 * 1024 ** 3,
      gpuProbe: "ok",
    });
  });
});

describe("whether an Ollama address is on the worker's own machine", () => {
  it.each([
    "http://localhost:11434",
    "http://127.0.0.1:11434",
    "http://127.1.2.3:11434",
    "http://[::1]:11434",
    "http://host.docker.internal:11434",
    "http://172.17.0.1:11434",
    "http://my-box:11434",
  ])("counts %s as its own", (url) => {
    expect(isColocated(url, "my-box")).toBe(true);
  });

  it.each([
    "http://desktop.lan:11434",
    "http://192.168.1.20:11434",
    "https://ollama.example.com",
    "not a url",
  ])("counts %s as another machine", (url) => {
    expect(isColocated(url, "my-box")).toBe(false);
  });

  it("does not hand a visible GPU to a remote Ollama, which is the GTX 1660 case", async () => {
    const host = await probeGpus(programs({ "nvidia-smi": "NVIDIA GeForce GTX 1660, 6144" }));
    expect(host.gpus).toHaveLength(1);
    expect(isColocated("http://desktop.lan:11434", "homelab")).toBe(false);
  });
});
