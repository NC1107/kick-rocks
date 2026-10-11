import { API_ROUTES, BENCH_NUM_CTX, type WorkerHeartbeatBody } from "@kickrocks/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../../test-utils/index.js";
import { PROBE_BODY_LIMIT_BYTES } from "./ollama-probe.js";

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

interface FakeOllama {
  version?: string;
  models?: { name: string; digest: string; size?: number }[];
  loaded?: { name: string; size: number; size_vram: number; context_length?: number }[];
  /** Replaces the answer to one path with a raw response. */
  override?: (path: string) => Response | undefined;
  delayMs?: number;
}

/** A network where only the listed `host:port` pairs answer, and every other address refuses. */
function network(hosts: Record<string, FakeOllama>) {
  const calls: { url: string; authorization: string | null }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ url: url.href, authorization: headers.get("authorization") });
    const host = hosts[url.host];
    if (!host) throw new TypeError("fetch failed");
    if (host.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, host.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal?.reason);
        });
      });
    }
    const replaced = host.override?.(url.pathname);
    if (replaced) return replaced;
    if (url.pathname === "/api/version")
      return Response.json({ version: host.version ?? "0.12.0" });
    if (url.pathname === "/api/tags") return Response.json({ models: host.models ?? [] });
    if (url.pathname === "/api/ps") return Response.json({ models: host.loaded ?? [] });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { impl, calls, hosts: () => new Set(calls.map((call) => new URL(call.url).host)) };
}

const GPT_OSS = { name: "gpt-oss:20b", digest: "digest-gpt-oss", size: 13_000_000_000 };
const QWEN = { name: "qwen3:8b", digest: "digest-qwen", size: 5_200_000_000 };

async function start(hosts: Record<string, FakeOllama>) {
  const fake = network(hosts);
  ctx = await createTestContext({ overrides: { probeFetch: fake.impl } });
  return { ctx, fake };
}

async function setup(query?: Record<string, string>) {
  if (!ctx) throw new Error("start the context first");
  const result = await ctx.call(API_ROUTES.settingsAgentSetup, query ? { query } : {});
  if (!result.ok) throw new Error(`agent-setup answered ${result.status}`);
  return result.body;
}

function workerBeat(overrides: Partial<WorkerHeartbeatBody> = {}): WorkerHeartbeatBody {
  return {
    workerId: "agent-1",
    busy: false,
    claimer: "model",
    model: {
      provider: "ollama",
      name: "gpt-oss:20b",
      version: "digest-gpt-oss",
      thinking: "default",
      numCtx: BENCH_NUM_CTX,
    },
    host: {
      hostname: "nick-desktop",
      platform: "linux",
      arch: "x64",
      cpuCores: 16,
      memoryBytes: 64 * 1024 ** 3,
      gpus: [{ vendor: "nvidia", name: "RTX 5080", memoryBytes: 16303 * 1024 * 1024 }],
      gpuProbe: "ok",
    },
    ollama: {
      baseUrl: "http://localhost:11434",
      colocated: true,
      reachable: true,
      error: null,
      version: "0.12.0",
      models: [
        {
          ...GPT_OSS,
          sizeBytes: GPT_OSS.size,
          digest: GPT_OSS.digest,
          parameterSize: "20.9B",
          quantization: "MXFP4",
        },
      ],
      loaded: [],
      checkedAt: "2026-10-09T12:00:00.000Z",
    },
    accepts: ["agentModel"],
    ...overrides,
  };
}

async function beat(overrides: Partial<WorkerHeartbeatBody> = {}) {
  if (!ctx) throw new Error("start the context first");
  const result = await ctx.call(API_ROUTES.workerHeartbeat, { body: workerBeat(overrides) });
  if (!result.ok) throw new Error(`heartbeat answered ${result.status}`);
}

describe("which addresses the server tries", () => {
  it("tries the usual places, and nothing else, when no reply model is saved", async () => {
    const { fake } = await start({});
    const view = await setup();
    expect([...fake.hosts()].sort()).toEqual(
      ["127.0.0.1:11434", "172.17.0.1:11434", "host.docker.internal:11434", "ollama:11434"].sort(),
    );
    expect(view.components.server.endpoints.map((endpoint) => endpoint.source)).toEqual([
      "usual",
      "usual",
      "usual",
      "usual",
    ]);
    expect(view.missing).toContain("ollama");
  });

  it("tries only the saved address once a reply model is configured", async () => {
    const { ctx, fake } = await start({ "desktop:11434": { models: [QWEN] } });
    ctx.services.settings.set("llm", {
      baseUrl: "http://desktop:11434/v1",
      model: "qwen3:8b",
      apiKey: null,
    });
    const view = await setup();
    expect([...fake.hosts()]).toEqual(["desktop:11434"]);
    expect(view.components.server.endpoints[0]).toMatchObject({
      baseUrl: "http://desktop:11434",
      source: "saved",
      reachable: true,
    });
    expect(view.replyEndpoint).toBe("http://desktop:11434");
  });

  it("tries the worker's LAN address, which is how it finds a desktop Ollama, but not a loopback one", async () => {
    const { ctx, fake } = await start({ "192.168.1.20:11434": { models: [GPT_OSS] } });
    ctx.services.settings.set("llm", {
      baseUrl: "http://llm.example.com:11434/v1",
      model: "x",
      apiKey: null,
    });
    await beat({
      ollama: {
        ...workerBeat().ollama,
        baseUrl: "http://192.168.1.20:11434",
        colocated: false,
      } as never,
    });
    const lan = await setup();
    expect(fake.hosts().has("192.168.1.20:11434")).toBe(true);
    expect(
      lan.components.server.endpoints.find((endpoint) => endpoint.source === "worker"),
    ).toMatchObject({
      reachable: true,
    });

    fake.calls.length = 0;
    await beat();
    await setup();
    expect(fake.hosts().has("localhost:11434")).toBe(false);
    expect([...fake.hosts()]).not.toContain("192.168.1.20:11434");
  });

  it("sends the saved key only to the saved address", async () => {
    const { ctx, fake } = await start({
      "desktop:11434": { models: [QWEN] },
      "192.168.1.20:11434": { models: [QWEN] },
    });
    ctx.services.settings.set("llm", {
      baseUrl: "http://desktop:11434/v1",
      model: "qwen3:8b",
      apiKey: "secret-key",
    });
    await beat({
      ollama: {
        ...workerBeat().ollama,
        baseUrl: "http://192.168.1.20:11434",
        colocated: false,
      } as never,
    });
    await setup({ ask: "http://192.168.1.99:11434" });
    for (const call of fake.calls) {
      const saved = new URL(call.url).host === "desktop:11434";
      expect(call.authorization).toBe(saved ? "Bearer secret-key" : null);
    }
  });

  it("probes an address the person typed first", async () => {
    const { fake } = await start({ "10.0.0.9:11434": { models: [QWEN] } });
    const view = await setup({ ask: "http://10.0.0.9:11434/v1" });
    expect(view.components.server.endpoints[0]).toMatchObject({
      baseUrl: "http://10.0.0.9:11434",
      source: "asked",
      reachable: true,
    });
    expect(fake.calls[0]?.url).toContain("10.0.0.9");
  });
});

describe("what a probe returns", () => {
  it("returns parsed fields, never the raw body", async () => {
    await start({
      "10.0.0.9:11434": {
        version: "0.12.3",
        models: [{ ...GPT_OSS, extra: "secret" } as never],
        loaded: [
          {
            name: "gpt-oss:20b",
            size: 13_000_000_000,
            size_vram: 12_000_000_000,
            context_length: 16384,
          },
        ],
      },
    });
    const result = await ctx?.call(API_ROUTES.settingsAgentSetupProbe, {
      body: { baseUrl: "http://10.0.0.9:11434" },
    });
    expect(result?.ok && result.body).toMatchObject({
      reachable: true,
      version: "0.12.3",
      models: [{ name: "gpt-oss:20b", digest: "digest-gpt-oss" }],
      loaded: [{ name: "gpt-oss:20b", sizeVramBytes: 12_000_000_000, contextLength: 16384 }],
    });
    expect(JSON.stringify(result?.body)).not.toContain("secret");
  });

  it("reports a timeout as missing, so the person is asked for an address", async () => {
    await start({
      "127.0.0.1:11434": { delayMs: 5000 },
      "host.docker.internal:11434": { delayMs: 5000 },
      "172.17.0.1:11434": { delayMs: 5000 },
      "ollama:11434": { delayMs: 5000 },
    });
    const started = Date.now();
    const view = await setup();
    expect(Date.now() - started).toBeLessThan(4000);
    expect(view.components.server.endpoints.every((endpoint) => endpoint.error === "timeout")).toBe(
      true,
    );
    expect(view.missing).toContain("ollama");
  });

  it("refuses a redirect instead of following it", async () => {
    await start({
      "10.0.0.9:11434": {
        override: () =>
          new Response(null, { status: 302, headers: { location: "http://evil.example/" } }),
      },
    });
    const result = await ctx?.call(API_ROUTES.settingsAgentSetupProbe, {
      body: { baseUrl: "http://10.0.0.9:11434" },
    });
    expect(result?.ok && result.body).toMatchObject({ reachable: false, error: "redirect" });
  });

  it("holds the body cap, and a page that is not JSON is a bad response", async () => {
    await start({
      "10.0.0.9:11434": {
        override: (path) =>
          path === "/api/tags" ? new Response("x".repeat(PROBE_BODY_LIMIT_BYTES + 10)) : undefined,
      },
      "10.0.0.10:11434": { override: () => new Response("<html></html>") },
    });
    const big = await ctx?.call(API_ROUTES.settingsAgentSetupProbe, {
      body: { baseUrl: "http://10.0.0.9:11434" },
    });
    expect(big?.ok && big.body).toMatchObject({ reachable: false, error: "too_large" });
    const html = await ctx?.call(API_ROUTES.settingsAgentSetupProbe, {
      body: { baseUrl: "http://10.0.0.10:11434" },
    });
    expect(html?.ok && html.body).toMatchObject({ reachable: false, error: "bad_response" });
  });
});

describe("whether the server and the worker reach one Ollama", () => {
  it("says probably when the version and every model digest match", async () => {
    const { ctx } = await start({ "192.168.1.20:11434": { version: "0.12.0", models: [GPT_OSS] } });
    ctx.services.settings.set("llm", {
      baseUrl: "http://192.168.1.20:11434/v1",
      model: "x",
      apiKey: null,
    });
    await beat({
      ollama: {
        ...workerBeat().ollama,
        baseUrl: "http://desktop.lan:11434",
        colocated: false,
      } as never,
    });
    expect((await setup()).sameOllama).toBe("probably");
  });

  it("says no when a digest differs, and unknown when one side is missing", async () => {
    const { ctx } = await start({
      "192.168.1.20:11434": {
        version: "0.12.0",
        models: [{ ...GPT_OSS, digest: "another-build" }],
      },
    });
    ctx.services.settings.set("llm", {
      baseUrl: "http://192.168.1.20:11434/v1",
      model: "x",
      apiKey: null,
    });
    expect((await setup()).sameOllama).toBe("unknown");
    await beat({
      ollama: {
        ...workerBeat().ollama,
        baseUrl: "http://desktop.lan:11434",
        colocated: false,
      } as never,
    });
    expect((await setup()).sameOllama).toBe("no");
  });
});

describe("two machines that both say host.docker.internal", () => {
  const dockerHost = (owned: string) => ({
    ollama: {
      ...workerBeat().ollama,
      baseUrl: `http://${owned}:11434`,
      colocated: true,
    } as never,
  });

  it("does not take the same name for the same server", async () => {
    const { ctx } = await start({
      "host.docker.internal:11434": { version: "0.12.0", models: [QWEN] },
    });
    ctx.services.settings.set("llm", {
      baseUrl: "http://host.docker.internal:11434/v1",
      model: "qwen3:8b",
      apiKey: null,
    });
    await beat(dockerHost("host.docker.internal"));
    const view = await setup();
    expect(view.sameOllama).toBe("no");
    expect(view.gpu.reply.gib).toBeNull();
    expect(view.recommendation.reply?.sameCopy).not.toBe(true);
  });

  it("still calls one LAN address the same server", async () => {
    const { ctx } = await start({
      "192.168.1.20:11434": { version: "0.12.0", models: [QWEN] },
    });
    ctx.services.settings.set("llm", {
      baseUrl: "http://192.168.1.20:11434/v1",
      model: "x",
      apiKey: null,
    });
    await beat(dockerHost("192.168.1.20"));
    expect((await setup()).sameOllama).toBe("yes");
  });
});

describe("the gate state of each installed model", () => {
  it("compares the real digest, so a pass for another build is out of date", async () => {
    await start({});
    if (!ctx) throw new Error("no context");
    ctx.services.settings.set("agent.gate", {
      records: [
        {
          model: {
            provider: "ollama",
            name: "gpt-oss:20b",
            version: "an-older-build",
            thinking: "default",
            numCtx: BENCH_NUM_CTX,
          },
          source: "bench",
          recordedAt: "2026-10-01T00:00:00.000Z",
          runs: 40,
        },
      ],
    });
    await beat();
    const stale = await setup();
    expect(stale.installedGate).toEqual([
      expect.objectContaining({
        name: "gpt-oss:20b",
        verdict: expect.objectContaining({ state: "stale" }),
      }),
    ]);

    ctx.services.settings.set("agent.gate", {
      records: [
        {
          model: {
            provider: "ollama",
            name: "gpt-oss:20b",
            version: "digest-gpt-oss",
            thinking: "default",
            numCtx: BENCH_NUM_CTX,
          },
          source: "bench",
          recordedAt: "2026-10-01T00:00:00.000Z",
          runs: 40,
        },
      ],
    });
    const passed = await setup();
    expect(passed.installedGate[0]?.verdict.state).toBe("passed");
    expect(passed.recommendation.agent).toMatchObject({ name: "gpt-oss:20b", gate: "passed" });
  });
});

describe("the memory of the card", () => {
  it("reads the worker's card only when its Ollama runs on the same machine", async () => {
    await start({});
    await beat();
    const local = await setup();
    expect(local.gpu.agent).toMatchObject({ gib: 15.9, source: "worker_gpu" });
    expect(local.missing).not.toContain("gpuMemory");
    expect(local.recommendation.agent?.name).toBe("gpt-oss:20b");

    await beat({
      ollama: {
        ...workerBeat().ollama,
        baseUrl: "http://desktop.lan:11434",
        colocated: false,
      } as never,
    });
    const remote = await setup();
    expect(remote.gpu.agent.gib).toBeNull();
    expect(remote.missing).toContain("gpuMemory");
    expect(remote.recommendation.agent).toBeNull();
  });

  it("works out a bound from what is loaded, and takes the person's answer over it", async () => {
    await start({});
    const loaded = [
      {
        name: "gpt-oss:20b",
        sizeBytes: 12.7 * 1024 ** 3,
        sizeVramBytes: 12.7 * 1024 ** 3,
        contextLength: 16384,
      },
    ];
    await beat({
      host: { ...workerBeat().host, gpus: [], gpuProbe: "no_tool" } as never,
      ollama: { ...workerBeat().ollama, loaded } as never,
    });
    const bounded = await setup();
    expect(bounded.gpu.agent).toMatchObject({ gib: null, source: "loaded_model" });
    expect(bounded.gpu.agent.atLeastGib).toBeCloseTo(12.7, 1);
    expect(bounded.recommendation.agent?.name).toBe("gpt-oss:20b");
    expect(bounded.missing).toEqual(["gpuMemory"]);

    await ctx?.call(API_ROUTES.settingsPatch, { body: { agent: { gpuMemoryGb: { worker: 12 } } } });
    const asked = await setup();
    expect(asked.gpu.agent).toMatchObject({ gib: 12, source: "asked" });
    expect(asked.recommendation.agent).toBeNull();
    expect(asked.recommendation.pull).toBe("ollama pull qwen3:14b");
  });
});

describe("hosted endpoints and repeated addresses", () => {
  it("does not probe a saved hosted endpoint, so its key never leaves on page load", async () => {
    const { ctx, fake } = await start({});
    ctx.services.settings.set("llm", {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      apiKey: "secret-key",
    });
    await setup();
    expect(fake.calls).toEqual([]);
  });

  it("keeps the key when the person types the saved address again", async () => {
    const { ctx, fake } = await start({ "ollama.example.lan:11434": { models: [QWEN] } });
    ctx.services.settings.set("llm", {
      baseUrl: "http://ollama.example.lan:11434/v1",
      model: "qwen3:8b",
      apiKey: "secret-key",
    });
    const view = await setup({ ask: "http://ollama.example.lan:11434" });
    expect(view.components.server.endpoints).toHaveLength(1);
    expect(view.components.server.endpoints[0]?.source).toBe("saved");
    expect(fake.calls.every((call) => call.authorization === "Bearer secret-key")).toBe(true);
  });

  it("skips a saved address too long to report instead of failing the route", async () => {
    const { ctx } = await start({});
    ctx.services.settings.set("llm", {
      baseUrl: `http://desktop:11434/${"a".repeat(600)}/v1`,
      model: "x",
      apiKey: null,
    });
    const view = await setup();
    expect(view.components.server.endpoints).toEqual([]);
  });
});
