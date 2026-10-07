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

const API_VERSION = "2023-06-01";

export interface AnthropicProviderOptions extends Partial<HttpOptions> {
  baseUrl: string;
  model: string;
  apiKey: string;
}

const Block = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() }),
]);

const MessageResponse = z.object({
  content: z.array(z.union([Block, z.object({ type: z.string() })])),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().nullish(),
      cache_read_input_tokens: z.number().nullish(),
    })
    .nullish(),
});

type WireMessage = { role: "user" | "assistant"; content: Record<string, unknown>[] };

function toWire(messages: Message[]): WireMessage[] {
  const wire: WireMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      wire.push({ role: "user", content: [{ type: "text", text: message.text }] });
    } else if (message.role === "assistant") {
      const content: Record<string, unknown>[] = [];
      if (message.text !== "") content.push({ type: "text", text: message.text });
      for (const call of message.toolCalls) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.args ?? {} });
      }
      // A turn with neither text nor a call cannot be sent back, so say that the model was silent.
      if (content.length === 0) content.push({ type: "text", text: "(no answer)" });
      wire.push({ role: "assistant", content });
    } else {
      // Every result for one assistant turn has to arrive together, in one user message.
      wire.push({
        role: "user",
        content: message.results.map((result) => ({
          type: "tool_result",
          tool_use_id: result.callId,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        })),
      });
    }
  }
  return wire;
}

export function createAnthropicProvider(options: AnthropicProviderOptions): ModelProvider {
  const http: HttpOptions = { ...options, fetch: options.fetch ?? fetch };
  return {
    name: "anthropic",
    model: options.model,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const answer = await postJson(
        `${options.baseUrl}/v1/messages`,
        { "x-api-key": options.apiKey, "anthropic-version": API_VERSION },
        {
          model: options.model,
          system: request.system,
          messages: toWire(request.messages),
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters,
          })),
          tool_choice: { type: "auto" },
          temperature: 0,
          max_tokens: request.maxOutputTokens,
        },
        request.signal,
        http,
      );
      const parsed = MessageResponse.safeParse(answer);
      if (!parsed.success) throw malformed("content");
      const text: string[] = [];
      const toolCalls: ToolCall[] = [];
      for (const block of parsed.data.content) {
        if (block.type === "text" && "text" in block) text.push(block.text);
        if (block.type === "tool_use" && "id" in block) {
          toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
        }
      }
      const usage = parsed.data.usage;
      return {
        text: text.join("\n"),
        toolCalls,
        usage: {
          inputTokens:
            (usage?.input_tokens ?? 0) +
            (usage?.cache_creation_input_tokens ?? 0) +
            (usage?.cache_read_input_tokens ?? 0),
          outputTokens: usage?.output_tokens ?? 0,
        },
      };
    },
  };
}
