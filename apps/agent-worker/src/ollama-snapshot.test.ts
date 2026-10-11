import { describe, expect, it, vi } from "vitest";
import { createOllamaSnapshot } from "./ollama-snapshot.js";

type Handler = (path: string) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    return handler(path);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const healthy: Handler = (path) => {
  if (path === "/api/version") return Response.json({ version: "0.12.3" });
  if (path === "/api/tags") {
    return Response.json({
      models: [
        {
          name: "gpt-oss:20b",
          digest: "sha256:abc",
          size: 13_000_000_000,
          details: { parameter_size: "20.9B", quantization_level: "MXFP4" },
        },
        { name: "qwen3:8b", digest: "sha256:def", size: 5_200_000_000, details: {} },
      ],
    });
  }
  return Response.json({
    models: [
      {
        name: "gpt-oss:20b",
        size: 12_748_796_722,
        size_vram: 12_748_796_722,
        context_length: 16384,
      },
    ],
  });
};

const snapshotOf = (impl: typeof fetch, baseUrl = "http://localhost:11434", now = () => 0) =>
  createOllamaSnapshot({ baseUrl, fetch: impl, now, ownHostname: "homelab" });

describe("the worker's Ollama snapshot", () => {
  it("reads the version, the installed models and the loaded ones in one go", async () => {
    const { impl, calls } = fakeFetch(healthy);
    const reading = await snapshotOf(impl).get();
    expect(calls.sort()).toEqual(["/api/ps", "/api/tags", "/api/version"]);
    expect(reading).toMatchObject({
      reachable: true,
      error: null,
      version: "0.12.3",
      colocated: true,
      models: [
        {
          name: "gpt-oss:20b",
          digest: "sha256:abc",
          parameterSize: "20.9B",
          quantization: "MXFP4",
        },
        { name: "qwen3:8b", parameterSize: null, quantization: null },
      ],
      loaded: [{ name: "gpt-oss:20b", sizeVramBytes: 12_748_796_722, contextLength: 16384 }],
    });
  });

  it("drops credentials from the address it reports, and marks a remote server as not colocated", async () => {
    const { impl } = fakeFetch(healthy);
    const reading = await snapshotOf(impl, "http://user:secret@desktop.lan:11434/v1").get();
    expect(reading.baseUrl).toBe("http://desktop.lan:11434");
    expect(reading.colocated).toBe(false);
  });

  it("reports an unreachable server", async () => {
    const { impl } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await snapshotOf(impl).get()).toMatchObject({
      reachable: false,
      error: "unreachable",
      models: [],
      loaded: [],
      version: null,
    });
  });

  it("reports a timeout apart from a refused connection", async () => {
    const { impl } = fakeFetch(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect((await snapshotOf(impl).get()).error).toBe("timeout");
  });

  it("reports an answer that is not JSON, or not a success, as a bad response", async () => {
    const html = fakeFetch(() => new Response("<html>login</html>", { status: 200 }));
    expect((await snapshotOf(html.impl).get()).error).toBe("bad_response");
    const refused = fakeFetch(() => new Response("no", { status: 403 }));
    expect((await snapshotOf(refused.impl).get()).error).toBe("bad_response");
  });

  it("keeps the models when only the loaded list fails", async () => {
    const { impl } = fakeFetch((path) =>
      path === "/api/ps" ? new Response("nope", { status: 500 }) : healthy(path),
    );
    const reading = await snapshotOf(impl).get();
    expect(reading.reachable).toBe(true);
    expect(reading.models).toHaveLength(2);
    expect(reading.loaded).toEqual([]);
  });

  it("lists at most 200 models", async () => {
    const many = Array.from({ length: 450 }, (_, index) => ({
      name: `model-${index}:1b`,
      digest: `d${index}`,
      size: 1,
    }));
    const { impl } = fakeFetch((path) =>
      path === "/api/tags" ? Response.json({ models: many }) : healthy(path),
    );
    expect((await snapshotOf(impl).get()).models).toHaveLength(200);
  });

  it("looks again only after thirty seconds, or when told to forget", async () => {
    const { impl, calls } = fakeFetch(healthy);
    let clock = 0;
    const snapshot = snapshotOf(impl, "http://localhost:11434", () => clock);
    await snapshot.get();
    clock = 29_000;
    await snapshot.get();
    expect(calls).toHaveLength(3);
    snapshot.invalidate();
    await snapshot.get();
    expect(calls).toHaveLength(6);
    clock = 60_000;
    await snapshot.get();
    expect(calls).toHaveLength(9);
  });
});
