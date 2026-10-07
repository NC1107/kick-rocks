import { z } from "zod";
import {
  type HttpOptions,
  type Message,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  malformed,
  postJson,
  type ToolCall,
} from "../provider.js";

export interface OpenAiProviderOptions extends Partial<HttpOptions> {
  baseUrl: string;
  model: string;
  apiKey: string | null;
}

const Completion = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().nullish(),
                function: z.object({
                  name: z.string(),
                  arguments: z.union([z.string(), z.record(z.string(), z.unknown())]).nullish(),
                }),
              }),
            )
            .nullish(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .nullish(),
});

type WireMessage = Record<string, unknown>;

function toWire(system: string, messages: Message[]): WireMessage[] {
  const wire: WireMessage[] = [{ role: "system", content: system }];
  for (const message of messages) {
    if (message.role === "user") {
      wire.push({ role: "user", content: message.text });
    } else if (message.role === "assistant") {
      wire.push({
        role: "assistant",
        content: message.text === "" ? null : message.text,
        ...(message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
              })),
            }
          : {}),
      });
    } else {
      for (const result of message.results) {
        wire.push({ role: "tool", tool_call_id: result.callId, content: result.content });
      }
    }
  }
  return wire;
}

function parseArguments(raw: string | Record<string, unknown> | null | undefined): {
  args: unknown;
  argsError?: string;
} {
  if (raw === null || raw === undefined || raw === "") return { args: {} };
  if (typeof raw !== "string") return { args: raw };
  try {
    return { args: JSON.parse(raw) };
  } catch {
    return { args: {}, argsError: "The tool arguments were not valid JSON" };
  }
}

/** Any OpenAI-compatible chat completions endpoint, which includes Ollama at /v1. */
export function createOpenAiProvider(options: OpenAiProviderOptions): ModelProvider {
  const http: HttpOptions = { ...options, fetch: options.fetch ?? fetch };
  return {
    name: "openai",
    model: options.model,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const answer = await postJson(
        `${options.baseUrl}/chat/completions`,
        options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {},
        {
          model: options.model,
          messages: toWire(request.system, request.messages),
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          tool_choice: "auto",
          temperature: 0,
          max_tokens: request.maxOutputTokens,
          stream: false,
        },
        request.signal,
        http,
      );
      const parsed = Completion.safeParse(answer);
      const message = parsed.success ? parsed.data.choices[0]?.message : undefined;
      if (!parsed.success || !message) throw malformed("a message");
      const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call, index) => ({
        id: call.id || `call_${index}`,
        name: call.function.name,
        ...parseArguments(call.function.arguments),
      }));
      return {
        text: message.content ?? "",
        toolCalls,
        usage: {
          inputTokens: parsed.data.usage?.prompt_tokens ?? 0,
          outputTokens: parsed.data.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}
