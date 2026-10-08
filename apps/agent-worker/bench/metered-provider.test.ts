import { describe, expect, it } from "vitest";
import type { ModelProvider, ModelRequest, ModelResponse } from "../src/provider.js";
import { ProviderError } from "../src/provider.js";
import { MeteredProvider, PROVIDER_ERROR, TEXT_ONLY_TURN } from "./metered-provider.js";
import { saveCalls } from "./run-scenario.js";

const REQUEST: ModelRequest = {
  system: "",
  messages: [],
  tools: [],
  maxOutputTokens: 100,
  signal: new AbortController().signal,
};

function provider(answers: (ModelResponse | Error)[]): MeteredProvider {
  let turn = 0;
  const inner: ModelProvider = {
    name: "fake",
    model: "fake",
    async complete() {
      const answer = answers[turn++];
      if (answer === undefined) throw new Error("out of answers");
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return new MeteredProvider(inner);
}

const usage = { inputTokens: 1, outputTokens: 1 };

describe("MeteredProvider diagnostics", () => {
  it("records a turn without a tool call, with its text cut to 500 characters", async () => {
    const metered = provider([{ text: "x".repeat(900), toolCalls: [], usage }]);
    await metered.complete(REQUEST);
    expect(metered.calls).toHaveLength(1);
    expect(metered.calls[0]).toMatchObject({ name: TEXT_ONLY_TURN, args: null });
    expect(metered.calls[0]?.text).toHaveLength(503);
    expect(metered.calls[0]?.text?.endsWith("...")).toBe(true);
    expect(metered.metrics.textOnlyTurns).toBe(1);
  });

  it("records a provider error with its message, and counts it as an endpoint error", async () => {
    const metered = provider([
      new ProviderError("The model endpoint answered 503: busy", "unavailable", 503),
    ]);
    await expect(metered.complete(REQUEST)).rejects.toThrow("busy");
    expect(metered.calls[0]).toMatchObject({
      name: PROVIDER_ERROR,
      text: "The model endpoint answered 503: busy",
    });
    expect(metered.metrics).toMatchObject({ providerErrors: 1, toolCallErrors: 0 });
  });

  it("counts a tool call the endpoint could not read as a tool-call error, not an outage", async () => {
    const metered = provider([
      new ProviderError("error parsing tool call", "unavailable", 500, false, true),
    ]);
    await expect(metered.complete(REQUEST)).rejects.toThrow();
    expect(metered.metrics).toMatchObject({ providerErrors: 0, toolCallErrors: 1 });
    expect(metered.calls[0]?.name).toBe(PROVIDER_ERROR);
  });

  it("keeps the text of those entries in the saved calls, with the tokens the turn wrote", async () => {
    const metered = provider([
      { text: "I am done", toolCalls: [], usage: { inputTokens: 40, outputTokens: 7 } },
    ]);
    await metered.complete(REQUEST);
    expect(saveCalls(metered.calls)).toEqual([
      { name: TEXT_ONLY_TURN, args: null, text: "I am done", outputTokens: 7 },
    ]);
  });

  it("tells an empty turn from a dropped call by the tokens it wrote", async () => {
    const metered = provider([
      { text: "", toolCalls: [], usage: { inputTokens: 40, outputTokens: 0 } },
      { text: "", toolCalls: [], usage: { inputTokens: 40, outputTokens: 260 } },
    ]);
    await metered.complete(REQUEST);
    await metered.complete(REQUEST);
    expect(saveCalls(metered.calls).map((call) => call.outputTokens)).toEqual([0, 260]);
  });
});
