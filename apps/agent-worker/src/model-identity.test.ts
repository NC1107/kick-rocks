import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "./config.js";
import { describeModel, modelIdentitySource } from "./model-identity.js";
import { createOllamaSnapshot } from "./ollama-snapshot.js";

const OLLAMA: ProviderConfig = {
  kind: "ollama",
  model: "gpt-oss:20b",
  baseUrl: "http://127.0.0.1:11434",
  apiKey: null,
  maxOutputTokens: 4096,
  tokenParam: "max_tokens",
  numCtx: 16_384,
  thinking: "off",
};

function ollama(models: { name: string; digest: string }[], seen: string[] = []): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    seen.push(path);
    if (path === "/api/tags") return Response.json({ models });
    if (path === "/api/version") return Response.json({ version: "0.12.0" });
    return Response.json({ models: [] });
  }) as unknown as typeof fetch;
}

describe("which build of a model the worker drives", () => {
  it("reads the digest ollama reports for the tag", async () => {
    const seen: string[] = [];
    const fetchImpl = ollama(
      [
        { name: "qwen3:8b", digest: "aaa" },
        { name: "gpt-oss:20b", digest: "bbb" },
      ],
      seen,
    );
    expect(await describeModel(OLLAMA, fetchImpl)).toEqual({
      provider: "ollama",
      name: "gpt-oss:20b",
      version: "bbb",
      thinking: "off",
      numCtx: 16_384,
    });
    expect(seen).toContain("/api/tags");
  });

  it("treats a tag with and without :latest as the same model", async () => {
    const fetchImpl = ollama([{ name: "llama3.2:latest", digest: "ccc" }]);
    const identity = await describeModel({ ...OLLAMA, model: "llama3.2" }, fetchImpl);
    expect(identity.version).toBe("ccc");
  });

  it("has no digest when ollama cannot be reached or does not list the tag", async () => {
    const down = vi.fn(async () => {
      throw new Error("refused");
    }) as unknown as typeof fetch;
    expect((await describeModel(OLLAMA, down)).version).toBeNull();
    expect((await describeModel(OLLAMA, ollama([]))).version).toBeNull();
  });

  it("has no version or context for a provider that does not report them", async () => {
    const hosted: ProviderConfig = { ...OLLAMA, kind: "anthropic", model: "a-hosted-model" };
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await describeModel(hosted, fetchImpl)).toMatchObject({ version: null, numCtx: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("looks again once the snapshot's cache runs out, so a pulled model is noticed", async () => {
    let digest = "one";
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      new URL(String(input)).pathname === "/api/tags"
        ? Response.json({ models: [{ name: "gpt-oss:20b", digest }] })
        : Response.json({}),
    ) as unknown as typeof fetch;
    let clock = 0;
    const snapshots = createOllamaSnapshot({
      baseUrl: OLLAMA.baseUrl,
      fetch: fetchImpl,
      now: () => clock,
    });
    const identity = modelIdentitySource(OLLAMA, snapshots);

    expect((await identity()).version).toBe("one");
    digest = "two";
    clock = 10_000;
    expect((await identity()).version).toBe("one");
    clock = 60_000;
    expect((await identity()).version).toBe("two");
  });
});
