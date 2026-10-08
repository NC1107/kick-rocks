import { type LlmSettings, ReplyClassification } from "@kickrocks/shared";
import { askLlm, LLM_TIMEOUT_MS } from "../../server/dist/mail/llm.js";
import { readVramMiB } from "./gpu.js";
import { REPLY_CASES, type ReplyCase } from "./reply-cases.js";

export type ReplyFailure = "invalid_json" | "invalid_schema" | "http_error" | "timeout_or_network";

export interface ReplyCaseResult {
  id: string;
  truth: ReplyClassification;
  predicted: ReplyClassification | null;
  correct: boolean;
  failure: ReplyFailure | null;
  latencyMs: number;
  fieldsCorrect: boolean | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ReplyRunSummary {
  total: number;
  correct: number;
  accuracy: number;
  invalidJson: number;
  invalidJsonRate: number;
  invalidSchema: number;
  otherFailures: number;
  latencyMs: { mean: number; median: number; p95: number; max: number };
  requestedFieldsAccuracy: number | null;
  perClass: Record<string, { cases: number; correct: number }>;
  confusions: { id: string; truth: string; predicted: string | null }[];
  peakVramMiB: number | null;
}

export interface ReplyRun {
  summary: ReplyRunSummary;
  cases: ReplyCaseResult[];
}

interface Captured {
  status: number;
  raw: string;
  latencyMs: number;
  threw: boolean;
}

/** Some models wrap JSON in a fence even when told not to; the server strips it, and so does this. */
function stripFence(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function failureOf(captured: Captured): ReplyFailure {
  if (captured.threw) return "timeout_or_network";
  if (captured.status < 200 || captured.status >= 300) return "http_error";
  let content: unknown;
  try {
    content = (JSON.parse(captured.raw) as { choices?: { message?: { content?: unknown } }[] })
      .choices?.[0]?.message?.content;
  } catch {
    return "http_error";
  }
  if (typeof content !== "string") return "invalid_json";
  try {
    JSON.parse(stripFence(content));
  } catch {
    return "invalid_json";
  }
  return "invalid_schema";
}

function usageOf(raw: string): { input: number | null; output: number | null } {
  try {
    const usage = (
      JSON.parse(raw) as { usage?: { prompt_tokens?: number; completion_tokens?: number } }
    ).usage;
    return { input: usage?.prompt_tokens ?? null, output: usage?.completion_tokens ?? null };
  } catch {
    return { input: null, output: null };
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export interface ReplyBenchOptions {
  settings: LlmSettings;
  /** Replaced by the fake models, which answer in process. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cases?: ReplyCase[];
}

/**
 * Sends every case through the server's own `askLlm`, so the prompt, the strict schema and the
 * answer parsing are the ones the mail pipeline uses. The fetch is wrapped only to see what the
 * endpoint said, because `askLlm` returns null for every kind of failure.
 */
export async function runReplyBench(options: ReplyBenchOptions): Promise<ReplyRun> {
  const cases = options.cases ?? REPLY_CASES;
  const base = options.fetchImpl ?? fetch;
  const results: ReplyCaseResult[] = [];
  let peakVram: number | null = null;

  for (const reply of cases) {
    let captured: Captured = { status: 0, raw: "", latencyMs: 0, threw: true };
    const started = performance.now();
    const recording: typeof fetch = async (input, init) => {
      try {
        const response = await base(input, init);
        const raw = await response.clone().text();
        captured = {
          status: response.status,
          raw,
          latencyMs: performance.now() - started,
          threw: false,
        };
        return response;
      } catch (error) {
        captured = { status: 0, raw: "", latencyMs: performance.now() - started, threw: true };
        throw error;
      }
    };
    const answer = await askLlm(
      options.settings,
      { subject: reply.subject, body: reply.body, hint: null },
      recording,
      options.timeoutMs ?? LLM_TIMEOUT_MS,
    );
    const latencyMs = captured.threw ? performance.now() - started : captured.latencyMs;
    const vram = await readVramMiB();
    if (vram !== null) peakVram = Math.max(peakVram ?? 0, vram);
    const usage = usageOf(captured.raw);
    const parsed = answer;
    results.push({
      id: reply.id,
      truth: reply.truth,
      predicted: parsed?.classification ?? null,
      correct: parsed?.classification === reply.truth,
      failure: answer === null ? failureOf(captured) : null,
      latencyMs: Math.round(latencyMs),
      fieldsCorrect:
        reply.truth === "verification_required" && parsed
          ? sameSet(parsed.requested_fields, reply.requestedFields ?? [])
          : null,
      inputTokens: usage.input,
      outputTokens: usage.output,
    });
  }
  return { cases: results, summary: summarize(results, peakVram) };
}

function summarize(results: ReplyCaseResult[], peakVramMiB: number | null): ReplyRunSummary {
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const invalidJson = results.filter((r) => r.failure === "invalid_json").length;
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const mean = latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, total);
  const fieldCases = results.filter((r) => r.fieldsCorrect !== null);
  const perClass: ReplyRunSummary["perClass"] = Object.fromEntries(
    ReplyClassification.options.map((name) => [name, { cases: 0, correct: 0 }]),
  );
  for (const result of results) {
    const entry = perClass[result.truth];
    if (!entry) continue;
    entry.cases += 1;
    if (result.correct) entry.correct += 1;
  }
  return {
    total,
    correct,
    accuracy: total === 0 ? 0 : correct / total,
    invalidJson,
    invalidJsonRate: total === 0 ? 0 : invalidJson / total,
    invalidSchema: results.filter((r) => r.failure === "invalid_schema").length,
    otherFailures: results.filter(
      (r) => r.failure === "http_error" || r.failure === "timeout_or_network",
    ).length,
    latencyMs: {
      mean: Math.round(mean),
      median: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.at(-1) ?? 0,
    },
    requestedFieldsAccuracy:
      fieldCases.length === 0
        ? null
        : fieldCases.filter((r) => r.fieldsCorrect).length / fieldCases.length,
    perClass,
    confusions: results
      .filter((r) => !r.correct)
      .map((r) => ({ id: r.id, truth: r.truth, predicted: r.predicted })),
    peakVramMiB,
  };
}

/** A stand-in endpoint that knows the ground truth. A perfect one answers it, a bad one gets it wrong and breaks the JSON. */
export function fakeReplyFetch(
  kind: "perfect" | "bad",
  cases: ReplyCase[] = REPLY_CASES,
): typeof fetch {
  const labels = ReplyClassification.options;
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    const user = body.messages[1]?.content ?? "";
    const index = cases.findIndex(
      (c) =>
        user.startsWith(`Subject: ${c.subject.slice(0, 300)}\n`) &&
        user.endsWith(c.body.slice(0, 4000)),
    );
    const reply = cases[index];
    if (!reply) throw new Error("The fake endpoint was asked about a message it does not know");
    let content: string;
    if (kind === "perfect") {
      content = JSON.stringify({
        classification: reply.truth,
        confidence: 0.95,
        rationale: "ground truth",
        requested_fields: reply.requestedFields ?? [],
      });
    } else if (index % 4 === 0) {
      content = "I think this email is probably a bounce, but I am not sure.";
    } else if (index % 4 === 1) {
      content = '{"classification": "bounce", "confidence": 2}';
    } else {
      const wrong = labels[(labels.indexOf(reply.truth) + 3) % labels.length];
      content = JSON.stringify({
        classification: wrong,
        confidence: 0.9,
        rationale: "wrong on purpose",
        requested_fields: [],
      });
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 300, completion_tokens: 40 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}
