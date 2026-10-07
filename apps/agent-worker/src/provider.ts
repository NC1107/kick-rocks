import { sleepFor } from "@kickrocks/recipes";

export interface ToolSpec {
  name: string;
  description: string;
  /** A JSON Schema object, which both provider APIs take as is. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  /** Set when the model's arguments were not valid JSON, so the loop can tell it instead of guessing. */
  argsError?: string;
}

export interface ToolResult {
  callId: string;
  name: string;
  content: string;
  isError: boolean;
}

/** The conversation in one neutral shape; each provider maps it to its own wire format. */
export type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: ModelUsage;
}

export interface ModelRequest {
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/**
 * Why a model call failed, in terms of what the worker should do about the task:
 * - `unavailable`: the endpoint did not answer, or is overloaded. Nothing is wrong with the task.
 * - `config`: the key, the model name, or the model's tool support is wrong. Nothing is wrong with the task.
 * - `rejected`: the endpoint refused this conversation, such as a context that is too long.
 */
export type ProviderErrorKind = "unavailable" | "config" | "rejected";

export class ProviderError extends Error {
  override name = "ProviderError";

  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface HttpOptions {
  fetch: typeof fetch;
  /** Replaced in tests so a retry does not wait. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  requestTimeoutMs?: number;
  retries?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;
const DEFAULT_RETRIES = 2;

function classify(status: number, body: string): ProviderErrorKind {
  if (status === 401 || status === 403 || status === 404) return "config";
  if (status === 408 || status === 429 || status >= 500) return "unavailable";
  if (/does not support tools|tool use is not supported|tools? (are )?not supported/i.test(body)) {
    return "config";
  }
  return "rejected";
}

function messageFromErrorBody(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } | string };
    const error = parsed.error;
    if (typeof error === "string") return error;
    if (error && typeof error.message === "string") return error.message;
  } catch {
    // Not JSON, so the text itself is the best description there is.
  }
  return text;
}

function retryAfterMs(response: Response): number | null {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 30) * 1000 : null;
}

/**
 * Posts a JSON body and returns the parsed JSON answer. A busy or unreachable endpoint is tried a
 * couple of times with a growing pause before it is reported, so a blip does not cost the task.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  options: HttpOptions,
): Promise<unknown> {
  const sleep = options.sleep ?? sleepFor;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  let pause = 1000;
  for (let attempt = 0; ; attempt++) {
    let failure: ProviderError;
    let wait = pause;
    try {
      const response = await options.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
      const text = await response.text();
      if (response.ok) {
        try {
          return JSON.parse(text);
        } catch {
          throw new ProviderError(
            "The model endpoint answered with something that is not JSON",
            "unavailable",
          );
        }
      }
      failure = new ProviderError(
        `The model endpoint answered ${response.status}: ${messageFromErrorBody(text).slice(0, 300)}`,
        classify(response.status, text),
        response.status,
      );
      wait = retryAfterMs(response) ?? pause;
    } catch (error) {
      if (signal.aborted) throw error;
      failure =
        error instanceof ProviderError
          ? error
          : new ProviderError(
              `The model endpoint could not be reached: ${error instanceof Error ? error.message : String(error)}`,
              "unavailable",
            );
    }
    if (failure.kind !== "unavailable" || attempt >= retries) throw failure;
    await sleep(wait, signal);
    if (signal.aborted) throw failure;
    pause *= 2;
  }
}

/** Reads a value the endpoint should have sent, failing as an endpoint problem when it is missing. */
export function malformed(what: string): ProviderError {
  return new ProviderError(`The model endpoint answered without ${what}`, "unavailable");
}
