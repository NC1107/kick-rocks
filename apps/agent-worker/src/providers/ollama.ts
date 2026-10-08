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

interface OllamaProviderOptions extends Partial<HttpOptions> {
  baseUrl: string;
  model: string;
  apiKey: string | null;
  /**
   * The context window Ollama loads the model with. Its own default is 4096 tokens, and a prompt
   * that does not fit is cut at the front without any error, so every request names a size.
   */
  numCtx: number;
  /** Off sends think: false, which models that cannot think ignore. */
  thinking: "default" | "off";
}

const Completion = z.object({
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
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
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
        content: message.text,
        ...(message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                function: { name: call.name, arguments: call.args ?? {} },
              })),
            }
          : {}),
      });
    } else {
      for (const result of message.results) {
        wire.push({ role: "tool", tool_name: result.name, content: result.content });
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

/** Ollama's native chat API, which is the one that takes the context size and the thinking switch. */
export function createOllamaProvider(options: OllamaProviderOptions): ModelProvider {
  const http: HttpOptions = { ...options, fetch: options.fetch ?? fetch };
  let callNumber = 0;
  return {
    name: "ollama",
    model: options.model,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const answer = await postJson(
        `${options.baseUrl}/api/chat`,
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
          stream: false,
          ...(options.thinking === "off" ? { think: false } : {}),
          options: {
            num_ctx: options.numCtx,
            num_predict: request.maxOutputTokens,
            temperature: 0,
          },
        },
        request.signal,
        http,
      );
      const parsed = Completion.safeParse(answer);
      if (!parsed.success) throw malformed("a message");
      const { message } = parsed.data;
      const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call) => {
        callNumber += 1;
        return {
          id: call.id || `call_${callNumber}`,
          name: call.function.name,
          ...parseArguments(call.function.arguments),
        };
      });
      return {
        text: message.content ?? "",
        toolCalls,
        usage: {
          inputTokens: parsed.data.prompt_eval_count ?? 0,
          outputTokens: parsed.data.eval_count ?? 0,
        },
      };
    },
  };
}
