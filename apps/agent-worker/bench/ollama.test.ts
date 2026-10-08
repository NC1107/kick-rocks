import { describe, expect, it } from "vitest";
import { findLoadedModel } from "./ollama.js";

describe("findLoadedModel", () => {
  const loaded = [
    {
      name: "mistral-nemo-ctx16k:latest",
      model: "mistral-nemo-ctx16k:latest",
      context_length: 16384,
    },
    { name: "qwen3:8b-ctx16k", model: "qwen3:8b-ctx16k", context_length: 16384 },
  ];

  it("finds a model that Ollama lists under its :latest name", () => {
    expect(findLoadedModel(loaded, "mistral-nemo-ctx16k")?.context_length).toBe(16384);
  });

  it("finds a model named with :latest when the list has the bare name", () => {
    expect(findLoadedModel(loaded, "qwen3:8b-ctx16k:latest")?.context_length).toBe(16384);
  });

  it("finds a tagged model by its full name", () => {
    expect(findLoadedModel(loaded, "qwen3:8b-ctx16k")).toBe(loaded[1]);
  });

  it("does not mistake one model for another that shares a prefix", () => {
    expect(findLoadedModel(loaded, "qwen3:8b")).toBeUndefined();
    expect(findLoadedModel(loaded, "mistral-nemo")).toBeUndefined();
  });
});
