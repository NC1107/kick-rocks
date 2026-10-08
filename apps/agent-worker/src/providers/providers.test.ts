import { describe, expect, it } from "vitest";
import { type Message, type ModelRequest, ProviderError, type ToolSpec } from "../provider.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createProvider } from "./index.js";
import { createOllamaProvider } from "./ollama.js";
import { createOpenAiProvider } from "./openai.js";

interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

type Answer = { status?: number; body: unknown; headers?: Record<string, string> } | Error;

function fakeFetch(answers: Answer[]): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let index = 0;
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    if (answer instanceof Error) throw answer;
    if (answer === undefined) throw new Error("no answer scripted");
    return new Response(
      typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body),
      { status: answer.status ?? 200, headers: answer.headers ?? {} },
    );
  };
  return { fetch: impl as typeof fetch, calls };
}

const TOOLS: ToolSpec[] = [
  {
    name: "click",
    description: "Click",
    parameters: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
  },
];

const MESSAGES: Message[] = [
  { role: "user", text: "Begin" },
  {
    role: "assistant",
    text: "Opening it",
    toolCalls: [
      { id: "c1", name: "click", args: { ref: "e1" } },
      { id: "c2", name: "click", args: { ref: "e2" } },
    ],
  },
  {
    role: "tool",
    results: [
      { callId: "c1", name: "click", content: "ok", isError: false },
      { callId: "c2", name: "click", content: "no such control", isError: true },
    ],
  },
];

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    system: "You are an agent",
    messages: MESSAGES,
    tools: TOOLS,
    maxOutputTokens: 512,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("the OpenAI-compatible provider", () => {
  const completion = {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: "call_9",
              type: "function",
              function: { name: "click", arguments: '{"ref":"e3"}' },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 30 },
  };

  it("posts chat completions with tools, and maps the whole conversation", async () => {
    const { fetch, calls } = fakeFetch([{ body: completion }]);
    const provider = createOpenAiProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "qwen3:14b",
      apiKey: null,
      fetch,
    });
    const response = await provider.complete(request());

    expect(calls[0]?.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(calls[0]?.headers).not.toHaveProperty("authorization");
    expect(calls[0]?.body).toMatchObject({
      model: "qwen3:14b",
      temperature: 0,
      max_tokens: 512,
      stream: false,
      tool_choice: "auto",
      tools: [
        {
          type: "function",
          function: { name: "click", description: "Click", parameters: TOOLS[0]?.parameters },
        },
      ],
    });
    expect(calls[0]?.body.messages).toEqual([
      { role: "system", content: "You are an agent" },
      { role: "user", content: "Begin" },
      {
        role: "assistant",
        content: "Opening it",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "click", arguments: '{"ref":"e1"}' } },
          { id: "c2", type: "function", function: { name: "click", arguments: '{"ref":"e2"}' } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "ok" },
      { role: "tool", tool_call_id: "c2", content: "no such control" },
    ]);
    expect(response).toEqual({
      text: "",
      toolCalls: [{ id: "call_9", name: "click", args: { ref: "e3" } }],
      usage: { inputTokens: 120, outputTokens: 30 },
    });
  });

  it("asks an Ollama endpoint for no thinking only when thinking is off", async () => {
    const { fetch, calls } = fakeFetch([{ body: completion }, { body: completion }]);
    const options = { baseUrl: "http://h/v1", model: "qwen3:8b", apiKey: null, fetch };
    await createOpenAiProvider(options).complete(request());
    await createOpenAiProvider({ ...options, thinking: "off" }).complete(request());
    expect(calls[0]?.body).not.toHaveProperty("reasoning_effort");
    expect(calls[1]?.body.reasoning_effort).toBe("none");
  });

  it("sends a bearer key when one is set", async () => {
    const { fetch, calls } = fakeFetch([{ body: completion }]);
    await createOpenAiProvider({
      baseUrl: "https://x/v1",
      model: "m",
      apiKey: "k",
      fetch,
    }).complete(request());
    expect(calls[0]?.headers.authorization).toBe("Bearer k");
  });

  it("copes with a model that sends arguments as an object, no id, bad JSON, or nothing", async () => {
    const { fetch } = fakeFetch([
      {
        body: {
          choices: [
            {
              message: {
                content: "thinking",
                tool_calls: [
                  { function: { name: "click", arguments: { ref: "e1" } } },
                  { id: "", function: { name: "snapshot", arguments: "" } },
                  { id: "x", function: { name: "click", arguments: "{not json" } },
                ],
              },
            },
          ],
        },
      },
    ]);
    const response = await createOpenAiProvider({
      baseUrl: "http://h/v1",
      model: "m",
      apiKey: null,
      fetch,
    }).complete(request());
    expect(response.text).toBe("thinking");
    expect(response.toolCalls).toEqual([
      { id: "call_0", name: "click", args: { ref: "e1" } },
      { id: "call_1", name: "snapshot", args: {} },
      { id: "x", name: "click", args: {}, argsError: "The tool arguments were not valid JSON" },
    ]);
    expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("fails as an endpoint problem when the answer has no message", async () => {
    const { fetch } = fakeFetch([{ body: { choices: [] } }]);
    const provider = createOpenAiProvider({
      baseUrl: "http://h/v1",
      model: "m",
      apiKey: null,
      fetch,
      retries: 0,
    });
    await expect(provider.complete(request())).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("the Anthropic provider", () => {
  const answer = {
    content: [
      { type: "text", text: "Clicking" },
      { type: "tool_use", id: "toolu_1", name: "click", input: { ref: "e4" } },
      { type: "thinking", thinking: "..." },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 25,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 5,
    },
  };

  it("posts to messages with the key and version, and groups tool results in one user turn", async () => {
    const { fetch, calls } = fakeFetch([{ body: answer }]);
    const provider = createAnthropicProvider({
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-6",
      apiKey: "sk-test",
      fetch,
    });
    const response = await provider.complete(request());

    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]?.headers).toMatchObject({
      "x-api-key": "sk-test",
      "anthropic-version": "2023-06-01",
    });
    expect(calls[0]?.body).toMatchObject({
      model: "claude-sonnet-4-6",
      system: "You are an agent",
      max_tokens: 512,
      tool_choice: { type: "auto" },
      tools: [{ name: "click", description: "Click", input_schema: TOOLS[0]?.parameters }],
    });
    expect(calls[0]?.body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Begin" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Opening it" },
          { type: "tool_use", id: "c1", name: "click", input: { ref: "e1" } },
          { type: "tool_use", id: "c2", name: "click", input: { ref: "e2" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "c1", content: "ok" },
          { type: "tool_result", tool_use_id: "c2", content: "no such control", is_error: true },
        ],
      },
    ]);
    expect(response).toEqual({
      text: "Clicking",
      toolCalls: [{ id: "toolu_1", name: "click", args: { ref: "e4" } }],
      usage: { inputTokens: 115, outputTokens: 25 },
    });
  });

  it("never sends an empty assistant turn", async () => {
    const { fetch, calls } = fakeFetch([{ body: answer }]);
    const provider = createAnthropicProvider({
      baseUrl: "https://a",
      model: "m",
      apiKey: "k",
      fetch,
    });
    await provider.complete(
      request({
        messages: [
          { role: "user", text: "Begin" },
          { role: "assistant", text: "", toolCalls: [] },
        ],
      }),
    );
    const messages = calls[0]?.body.messages as { content: unknown[] }[];
    expect(messages[1]?.content).toEqual([{ type: "text", text: "(no answer)" }]);
  });

  it("is built from the config, with Ollama as the OpenAI default", () => {
    expect(
      createProvider({
        kind: "anthropic",
        model: "claude-sonnet-4-6",
        baseUrl: "https://api.anthropic.com",
        apiKey: "k",
        maxOutputTokens: 1,
        tokenParam: "max_tokens",
        numCtx: 16_384,
        thinking: "default",
      }).name,
    ).toBe("anthropic");
    const openai = createProvider({
      kind: "openai",
      model: "llama",
      baseUrl: "http://localhost:11434/v1",
      apiKey: null,
      maxOutputTokens: 1,
      tokenParam: "max_tokens",
      numCtx: 16_384,
      thinking: "default",
    });
    expect(openai).toMatchObject({ name: "openai", model: "llama" });
    const ollama = createProvider({
      kind: "ollama",
      model: "llama",
      baseUrl: "http://localhost:11434",
      apiKey: null,
      maxOutputTokens: 1,
      tokenParam: "max_tokens",
      numCtx: 16_384,
      thinking: "default",
    });
    expect(ollama).toMatchObject({ name: "ollama", model: "llama" });
  });
});

describe("the ollama provider", () => {
  const completion = {
    message: {
      role: "assistant",
      content: "",
      thinking: "I should click it",
      tool_calls: [{ id: "call_x1", function: { name: "click", arguments: { ref: "e3" } } }],
    },
    prompt_eval_count: 900,
    eval_count: 40,
  };

  function make(answers: Answer[], thinking: "default" | "off" = "default", numCtx = 16_384) {
    const { fetch, calls } = fakeFetch(answers);
    const provider = createOllamaProvider({
      baseUrl: "http://localhost:11434",
      model: "gpt-oss:20b",
      apiKey: null,
      numCtx,
      thinking,
      fetch,
    });
    return { provider, calls };
  }

  it("posts to the native chat API with the context size on every request", async () => {
    const { provider, calls } = make([{ body: completion }]);
    const response = await provider.complete(request());

    expect(calls[0]?.url).toBe("http://localhost:11434/api/chat");
    expect(calls[0]?.headers).not.toHaveProperty("authorization");
    expect(calls[0]?.body).toMatchObject({
      model: "gpt-oss:20b",
      stream: false,
      options: { num_ctx: 16_384, num_predict: 512, temperature: 0 },
      tools: [
        {
          type: "function",
          function: { name: "click", description: "Click", parameters: TOOLS[0]?.parameters },
        },
      ],
    });
    expect(calls[0]?.body).not.toHaveProperty("think");
    expect(response).toEqual({
      text: "",
      toolCalls: [{ id: "call_x1", name: "click", args: { ref: "e3" } }],
      usage: { inputTokens: 900, outputTokens: 40 },
    });
  });

  it("maps the whole conversation, with arguments as objects and results named by tool", async () => {
    const { provider, calls } = make([{ body: completion }]);
    await provider.complete(request());
    expect(calls[0]?.body.messages).toEqual([
      { role: "system", content: "You are an agent" },
      { role: "user", content: "Begin" },
      {
        role: "assistant",
        content: "Opening it",
        tool_calls: [
          { id: "c1", function: { name: "click", arguments: { ref: "e1" } } },
          { id: "c2", function: { name: "click", arguments: { ref: "e2" } } },
        ],
      },
      { role: "tool", tool_name: "click", content: "ok" },
      { role: "tool", tool_name: "click", content: "no such control" },
    ]);
  });

  it("takes the context size from its settings", async () => {
    const { provider, calls } = make([{ body: completion }], "default", 32_768);
    await provider.complete(request());
    expect(calls[0]?.body.options).toMatchObject({ num_ctx: 32_768 });
  });

  it("turns thinking off only when asked to", async () => {
    const { provider, calls } = make([{ body: completion }], "off");
    await provider.complete(request());
    expect(calls[0]?.body.think).toBe(false);
  });

  it("copes with a call that has no id, string arguments or bad JSON", async () => {
    const { provider } = make([
      {
        body: {
          message: {
            content: "ok",
            tool_calls: [
              { function: { name: "snapshot", arguments: "" } },
              { function: { name: "click", arguments: '{"ref":"e1"}' } },
              { function: { name: "click", arguments: "{nope" } },
            ],
          },
        },
      },
    ]);
    const response = await provider.complete(request());
    expect(response.toolCalls.map((call) => call.id)).toEqual(["call_1", "call_2", "call_3"]);
    expect(response.toolCalls[1]?.args).toEqual({ ref: "e1" });
    expect(response.toolCalls[2]?.argsError).toBe("The tool arguments were not valid JSON");
  });

  it("classifies a missing model as a configuration problem and a bare error as a refusal", async () => {
    const missing = make([{ status: 404, body: { error: "model 'x' not found" } }]);
    await expect(missing.provider.complete(request())).rejects.toMatchObject({ kind: "config" });
    const refused = make([{ status: 400, body: { error: "invalid request" } }]);
    await expect(refused.provider.complete(request())).rejects.toMatchObject({
      kind: "rejected",
    });
  });

  it("fails as an endpoint problem when the answer has no message", async () => {
    const { fetch } = fakeFetch([{ body: { done: true } }]);
    const provider = createOllamaProvider({
      baseUrl: "http://h",
      model: "m",
      apiKey: null,
      numCtx: 16_384,
      thinking: "default",
      fetch,
      retries: 0,
    });
    await expect(provider.complete(request())).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("how failures are classified and retried", () => {
  const make = (answers: Answer[], retries = 2) => {
    const sleeps: number[] = [];
    const { fetch, calls } = fakeFetch(answers);
    const provider = createOpenAiProvider({
      baseUrl: "http://h/v1",
      model: "m",
      apiKey: null,
      fetch,
      retries,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    return { provider, calls, sleeps };
  };
  const ok = {
    body: {
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    },
  };

  it.each([401, 403, 404])(
    "treats %s as a configuration problem and does not retry",
    async (status) => {
      const { provider, calls } = make([{ status, body: { error: { message: "nope" } } }]);
      const error = await provider.complete(request()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ kind: "config", status });
      expect((error as Error).message).toContain("nope");
      expect(calls).toHaveLength(1);
    },
  );

  it("treats a model that cannot use tools as a configuration problem", async () => {
    const { provider } = make([
      {
        status: 400,
        body: { error: { message: "registry.ollama.ai/library/gemma does not support tools" } },
      },
    ]);
    await expect(provider.complete(request())).rejects.toMatchObject({ kind: "config" });
  });

  it("treats another 400 as a refusal of this conversation, without a retry", async () => {
    const { provider, calls } = make([{ status: 400, body: { error: "context too long" } }]);
    await expect(provider.complete(request())).rejects.toMatchObject({
      kind: "rejected",
      message: expect.stringContaining("context too long"),
    });
    expect(calls).toHaveLength(1);
  });

  it("flags a conversation that is too long, and no other 400", async () => {
    const tooLong = make([
      {
        status: 400,
        body: {
          error: { code: "context_length_exceeded", message: "maximum context length is 8192" },
        },
      },
    ]);
    await expect(tooLong.provider.complete(request())).rejects.toMatchObject({
      kind: "rejected",
      contextTooLong: true,
    });
    const anthropic = make([
      { status: 400, body: { error: { message: "prompt is too long: 250000 tokens > 200000" } } },
    ]);
    await expect(anthropic.provider.complete(request())).rejects.toMatchObject({
      contextTooLong: true,
    });
    const tooBig = make([{ status: 413, body: "payload too large" }]);
    await expect(tooBig.provider.complete(request())).rejects.toMatchObject({
      contextTooLong: true,
    });
    const other = make([{ status: 400, body: { error: { message: "invalid tool schema" } } }]);
    await expect(other.provider.complete(request())).rejects.toMatchObject({
      kind: "rejected",
      contextTooLong: false,
    });
  });

  it("retries once with max_completion_tokens and no temperature when a reasoning model refuses max_tokens", async () => {
    const { provider, calls } = make([
      {
        status: 400,
        body: {
          error: {
            message:
              "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
          },
        },
      },
      ok,
      ok,
    ]);
    await provider.complete(request());
    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toMatchObject({ max_tokens: 512, temperature: 0 });
    expect(calls[1]?.body).toMatchObject({ max_completion_tokens: 512 });
    expect(calls[1]?.body).not.toHaveProperty("max_tokens");
    expect(calls[1]?.body).not.toHaveProperty("temperature");
    await provider.complete(request());
    expect(calls[2]?.body).toMatchObject({ max_completion_tokens: 512 });
    expect(calls[2]?.body).not.toHaveProperty("temperature");
  });

  it("retries once when a model refuses a temperature of 0", async () => {
    const { provider, calls } = make([
      {
        status: 400,
        body: {
          error: {
            message: "Unsupported value: 'temperature' does not support 0 with this model.",
          },
        },
      },
      ok,
    ]);
    await provider.complete(request());
    expect(calls[1]?.body).not.toHaveProperty("temperature");
  });

  it("does not retry a 400 that names neither parameter", async () => {
    const { provider, calls } = make([{ status: 400, body: { error: { message: "bad tools" } } }]);
    await expect(provider.complete(request())).rejects.toMatchObject({ kind: "rejected" });
    expect(calls).toHaveLength(1);
  });

  it("sends the configured output limit parameter, without a temperature", async () => {
    const { fetch, calls } = fakeFetch([ok]);
    const provider = createOpenAiProvider({
      baseUrl: "http://h/v1",
      model: "o-series",
      apiKey: null,
      tokenParam: "max_completion_tokens",
      fetch,
    });
    await provider.complete(request());
    expect(calls[0]?.body).toMatchObject({ max_completion_tokens: 512 });
    expect(calls[0]?.body).not.toHaveProperty("max_tokens");
    expect(calls[0]?.body).not.toHaveProperty("temperature");
  });

  it("retries a busy endpoint with a growing pause, then succeeds", async () => {
    const { provider, calls, sleeps } = make([
      { status: 503, body: "busy" },
      { status: 429, body: "slow down", headers: { "retry-after": "3" } },
      ok,
    ]);
    const response = await provider.complete(request());
    expect(response.text).toBe("hi");
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 3000]);
  });

  it("gives up as unavailable after the retries", async () => {
    const { provider, calls } = make([{ status: 500, body: "down" }]);
    await expect(provider.complete(request())).rejects.toMatchObject({
      kind: "unavailable",
      status: 500,
    });
    expect(calls).toHaveLength(3);
  });

  it("treats a connection that cannot be made as unavailable", async () => {
    const { provider } = make([new Error("connect ECONNREFUSED 127.0.0.1:11434")], 0);
    await expect(provider.complete(request())).rejects.toMatchObject({
      kind: "unavailable",
      message: expect.stringContaining("ECONNREFUSED"),
    });
  });

  it("treats an answer that is not JSON as unavailable", async () => {
    const { provider } = make([{ body: "<html>gateway</html>" }], 0);
    await expect(provider.complete(request())).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("stops at once when the run is aborted, without retrying", async () => {
    const controller = new AbortController();
    const { provider, calls } = make([new Error("aborted")]);
    controller.abort();
    await expect(provider.complete(request({ signal: controller.signal }))).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
