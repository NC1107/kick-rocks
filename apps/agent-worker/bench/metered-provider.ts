import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ToolCall,
  ToolResult,
} from "../src/provider.js";

export interface RecordedCall {
  name: string;
  args: unknown;
  argsError?: string;
  /** What the toolbox answered, once a later request carried it. The final call of a run has none. */
  result?: { content: string; isError: boolean };
}

/** Answers the worker gives when the model's arguments or report do not parse. */
const MALFORMED_CALL =
  /^(click needs|type needs|select needs|check needs|wait takes|There is no tool named|The report was not valid|The result does not match the required shape|Give either field or option)/;

export interface ModelMetrics {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** The largest prompt of any single call, which says how close the run came to the context window. */
  maxPromptTokens: number;
  /** Time spent waiting for the model, which is what tokens per second is measured against. */
  modelMs: number;
  /** Arguments that were not valid JSON, calls to tools that do not exist, and reports that failed validation. */
  toolCallErrors: number;
  /** Tool calls the worker answered with an error for another reason, such as a ref that had gone. */
  actionErrors: number;
  /** Turns in which the model answered with text and no tool call. */
  textOnlyTurns: number;
  providerErrors: number;
}

/** Counts what a model does without changing a request or an answer. */
export class MeteredProvider implements ModelProvider {
  readonly name: string;
  readonly model: string;
  readonly calls: RecordedCall[] = [];
  private readonly byId = new Map<string, RecordedCall>();
  private readonly counted = new Set<string>();
  private readonly totals: ModelMetrics = {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    maxPromptTokens: 0,
    modelMs: 0,
    toolCallErrors: 0,
    actionErrors: 0,
    textOnlyTurns: 0,
    providerErrors: 0,
  };

  constructor(private readonly inner: ModelProvider) {
    this.name = inner.name;
    this.model = inner.model;
  }

  get metrics(): ModelMetrics {
    return { ...this.totals };
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.collectResults(request);
    const started = performance.now();
    let response: ModelResponse;
    try {
      response = await this.inner.complete(request);
    } catch (error) {
      this.totals.providerErrors += 1;
      this.totals.modelMs += performance.now() - started;
      throw error;
    }
    this.totals.modelMs += performance.now() - started;
    this.totals.modelCalls += 1;
    this.totals.inputTokens += response.usage.inputTokens;
    this.totals.outputTokens += response.usage.outputTokens;
    this.totals.maxPromptTokens = Math.max(this.totals.maxPromptTokens, response.usage.inputTokens);
    if (response.toolCalls.length === 0) this.totals.textOnlyTurns += 1;
    for (const call of response.toolCalls) this.record(call);
    return response;
  }

  private record(call: ToolCall): void {
    const entry: RecordedCall = {
      name: call.name,
      args: call.args,
      ...(call.argsError === undefined ? {} : { argsError: call.argsError }),
    };
    if (call.argsError !== undefined) this.totals.toolCallErrors += 1;
    this.calls.push(entry);
    this.byId.set(call.id, entry);
  }

  private collectResults(request: ModelRequest): void {
    for (const message of request.messages) {
      if (message.role !== "tool") continue;
      for (const result of message.results) this.attach(result);
    }
  }

  private attach(result: ToolResult): void {
    const entry = this.byId.get(result.callId);
    if (!entry) return;
    // A snapshot is replaced by a stub once it is old, so the first answer seen is the one kept.
    entry.result ??= { content: result.content, isError: result.isError };
    if (!result.isError || this.counted.has(result.callId)) return;
    this.counted.add(result.callId);
    if (MALFORMED_CALL.test(result.content)) this.totals.toolCallErrors += 1;
    else this.totals.actionErrors += 1;
  }
}
