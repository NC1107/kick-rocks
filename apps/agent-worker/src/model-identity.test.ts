import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "./config.js";
import { describeModel, modelIdentitySource, ollamaDigest } from "./model-identity.js";

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

function tags(models: { name: string; digest: string }[]): typeof fetch {
  return vi.fn(async () => Response.json({ models })) as unknown as typeof fetch;
}

describe("which build of a model the worker drives", () => {
  it("reads the digest ollama reports for the tag", async () => {
    const fetchImpl = tags([
      { name: "qwen3:8b", digest: "aaa" },
      { name: "gpt-oss:20b", digest: "bbb" },
    ]);
    expect(await ollamaDigest("http://127.0.0.1:11434/v1", "gpt-oss:20b", fetchImpl)).toBe("bbb");
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:11434/api/tags", expect.anything());
  });

  it("treats a tag with and without :latest as the same model", async () => {
    const fetchImpl = tags([{ name: "llama3.2:latest", digest: "ccc" }]);
    expect(await ollamaDigest("http://x", "llama3.2", fetchImpl)).toBe("ccc");
  });

  it("has no digest when ollama cannot be reached or does not list the tag", async () => {
    const down = vi.fn(async () => {
      throw new Error("refused");
    }) as unknown as typeof fetch;
    expect(await ollamaDigest("http://x", "gpt-oss:20b", down)).toBeNull();
    expect(await ollamaDigest("http://x", "gpt-oss:20b", tags([]))).toBeNull();
  });

  it("describes the model with the settings that change how it behaves", async () => {
    expect(await describeModel(OLLAMA, tags([{ name: "gpt-oss:20b", digest: "bbb" }]))).toEqual({
      provider: "ollama",
      name: "gpt-oss:20b",
      version: "bbb",
      thinking: "off",
      numCtx: 16_384,
    });
  });

  it("has no version or context for a provider that does not report them", async () => {
    const hosted: ProviderConfig = { ...OLLAMA, kind: "anthropic", model: "a-hosted-model" };
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await describeModel(hosted, fetchImpl)).toMatchObject({ version: null, numCtx: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("looks again once the cache runs out, so a pulled model is noticed", async () => {
    let digest = "one";
    const fetchImpl = vi.fn(async () =>
      Response.json({ models: [{ name: "gpt-oss:20b", digest }] }),
    ) as unknown as typeof fetch;
    let clock = 0;
    const identity = modelIdentitySource(OLLAMA, { fetch: fetchImpl, now: () => clock });

    expect((await identity()).version).toBe("one");
    digest = "two";
    clock = 10_000;
    expect((await identity()).version).toBe("one");
    clock = 60_000;
    expect((await identity()).version).toBe("two");
  });
});
