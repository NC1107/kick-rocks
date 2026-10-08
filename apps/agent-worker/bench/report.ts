import type { ReplyRun } from "./replies.js";
import type { RunRecord } from "./run-scenario.js";
import { SCENARIOS } from "./scenarios.js";

export interface ScenarioSummary {
  id: number;
  slug: string;
  title: string;
  runs: number;
  successes: number;
  successRate: number;
  runsWithViolation: number;
  runsWithLeakedViolation: number;
  meanSteps: number;
  meanWallMs: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  meanTokensPerSecond: number | null;
  peakVramMiB: number | null;
  toolCallErrors: number;
  actionErrors: number;
  observed: Record<string, number>;
}

export interface AgentTotals {
  runs: number;
  successes: number;
  successRate: number;
  runsWithViolation: number;
  runsWithLeakedViolation: number;
  meanSteps: number;
  meanWallMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  maxPromptTokens: number;
  meanTokensPerSecond: number | null;
  peakVramMiB: number | null;
  toolCallErrors: number;
  actionErrors: number;
}

export interface BenchResults {
  model: string;
  startedAt: string;
  finishedAt: string;
  environment: {
    baseUrl: string;
    runsPerScenario: number;
    maxSteps: number;
    maxMinutes: number;
    maxOutputTokens: number;
    pace: string;
    idleVramMiB: number | null;
    ollamaContextLength: number | null;
    ollamaVramBytes: number | null;
  };
  agent: {
    totals: AgentTotals;
    scenarios: ScenarioSummary[];
    runs: RunRecord[];
  } | null;
  replies: {
    runs: ReplyRun[];
    accuracy: number;
    invalidJsonRate: number;
    meanLatencyMs: number;
  } | null;
}

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;

const meanOrNull = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : Math.round(mean(present) * 10) / 10;
};

const maxOrNull = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : Math.max(...present);
};

export function summarizeScenarios(runs: RunRecord[]): ScenarioSummary[] {
  return SCENARIOS.flatMap((scenario) => {
    const own = runs.filter((r) => r.scenario === scenario.id);
    if (own.length === 0) return [];
    const successes = own.filter((r) => r.success).length;
    const observed: Record<string, number> = {};
    for (const run of own) {
      observed[run.judgement.observed] = (observed[run.judgement.observed] ?? 0) + 1;
    }
    return [
      {
        id: scenario.id,
        slug: scenario.slug,
        title: scenario.title,
        runs: own.length,
        successes,
        successRate: successes / own.length,
        runsWithViolation: own.filter((r) => r.safetyViolation).length,
        runsWithLeakedViolation: own.filter((r) => r.leakedViolation).length,
        meanSteps: Math.round(mean(own.map((r) => r.steps)) * 10) / 10,
        meanWallMs: Math.round(mean(own.map((r) => r.wallMs))),
        meanInputTokens: Math.round(mean(own.map((r) => r.model.inputTokens))),
        meanOutputTokens: Math.round(mean(own.map((r) => r.model.outputTokens))),
        meanTokensPerSecond: meanOrNull(own.map((r) => r.tokensPerSecond)),
        peakVramMiB: maxOrNull(own.map((r) => r.peakVramMiB)),
        toolCallErrors: own.reduce((sum, r) => sum + r.model.toolCallErrors, 0),
        actionErrors: own.reduce((sum, r) => sum + r.model.actionErrors, 0),
        observed,
      },
    ];
  });
}

export function totalsOf(runs: RunRecord[]): AgentTotals {
  const successes = runs.filter((r) => r.success).length;
  return {
    runs: runs.length,
    successes,
    successRate: runs.length === 0 ? 0 : successes / runs.length,
    runsWithViolation: runs.filter((r) => r.safetyViolation).length,
    runsWithLeakedViolation: runs.filter((r) => r.leakedViolation).length,
    meanSteps: Math.round(mean(runs.map((r) => r.steps)) * 10) / 10,
    meanWallMs: Math.round(mean(runs.map((r) => r.wallMs))),
    totalInputTokens: runs.reduce((sum, r) => sum + r.model.inputTokens, 0),
    totalOutputTokens: runs.reduce((sum, r) => sum + r.model.outputTokens, 0),
    maxPromptTokens: Math.max(0, ...runs.map((r) => r.model.maxPromptTokens)),
    meanTokensPerSecond: meanOrNull(runs.map((r) => r.tokensPerSecond)),
    peakVramMiB: maxOrNull(runs.map((r) => r.peakVramMiB)),
    toolCallErrors: runs.reduce((sum, r) => sum + r.model.toolCallErrors, 0),
    actionErrors: runs.reduce((sum, r) => sum + r.model.actionErrors, 0),
  };
}

export function summarizeReplies(runs: ReplyRun[]): NonNullable<BenchResults["replies"]> {
  return {
    runs,
    accuracy: mean(runs.map((r) => r.summary.accuracy)),
    invalidJsonRate: mean(runs.map((r) => r.summary.invalidJsonRate)),
    meanLatencyMs: Math.round(mean(runs.map((r) => r.summary.latencyMs.mean))),
  };
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
const vram = (mib: number | null): string => (mib === null ? "n/a" : `${mib} MiB`);

/** One sentence per line, as the repository's Markdown rules ask. */
export function markdownSummary(results: BenchResults): string {
  const lines: string[] = [];
  const { environment: env } = results;
  lines.push(`# Agent model benchmark: ${results.model}`, "");
  lines.push(`Run from ${results.startedAt} to ${results.finishedAt}.`);
  lines.push(
    `Endpoint ${env.baseUrl}, ${env.runsPerScenario} run(s) per scenario, at most ${env.maxSteps} steps and ${env.maxMinutes} minutes per run, ${env.maxOutputTokens} output tokens per turn, ${env.pace} pace.`,
  );
  if (env.ollamaContextLength !== null) {
    lines.push(`Ollama loaded the model with a context of ${env.ollamaContextLength} tokens.`);
  }
  lines.push(`Idle GPU memory before the runs was ${vram(env.idleVramMiB)}.`, "");

  if (results.agent) {
    const { totals, scenarios } = results.agent;
    lines.push("## Agent scenarios", "");
    if (
      env.ollamaContextLength !== null &&
      totals.maxPromptTokens >= env.ollamaContextLength * 0.9
    ) {
      lines.push(
        `Warning: the largest prompt was ${totals.maxPromptTokens} tokens against a context of ${env.ollamaContextLength}, so Ollama may have cut the conversation short.`,
        "Raise OLLAMA_CONTEXT_LENGTH and run again before reading these numbers as the model's own.",
        "",
      );
    }
    lines.push(
      `Success ${totals.successes} of ${totals.runs} runs (${pct(totals.successRate)}).`,
      `Runs with a safety violation: ${totals.runsWithViolation}, of which ${totals.runsWithLeakedViolation} got past the worker's own checks.`,
      `Mean ${totals.meanSteps} steps and ${seconds(totals.meanWallMs)} per run, ${totals.totalInputTokens} tokens in and ${totals.totalOutputTokens} out in all.`,
      `Mean ${totals.meanTokensPerSecond ?? "n/a"} output tokens per second, peak GPU memory ${vram(totals.peakVramMiB)}.`,
      `Tool-call or JSON errors: ${totals.toolCallErrors}. Other failed actions: ${totals.actionErrors}.`,
      "",
    );
    lines.push(
      "| # | Scenario | Success | Violations (leaked) | Steps | Wall | Tokens in/out | tok/s | Peak VRAM | Call errors |",
      "|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const s of scenarios) {
      lines.push(
        `| ${s.id} | ${s.title} | ${s.successes}/${s.runs} | ${s.runsWithViolation} (${s.runsWithLeakedViolation}) | ${s.meanSteps} | ${seconds(s.meanWallMs)} | ${s.meanInputTokens}/${s.meanOutputTokens} | ${s.meanTokensPerSecond ?? "n/a"} | ${vram(s.peakVramMiB)} | ${s.toolCallErrors} |`,
      );
    }
    lines.push("");

    const failed = results.agent.runs.filter((r) => !r.success || r.safetyViolation);
    if (failed.length > 0) {
      lines.push("### Failures and violations", "");
      for (const run of failed) {
        lines.push(
          `- Scenario ${run.scenario} run ${run.run}: expected ${run.judgement.expected}, saw ${run.judgement.observed}.`,
        );
        if (run.judgement.failure) lines.push(`  - ${run.judgement.failure}`);
        for (const v of run.judgement.violations) {
          lines.push(
            `  - Violation ${v.kind}${v.enforced ? " (stopped by the worker)" : " (reached the site)"}: ${v.detail}`,
          );
        }
      }
      lines.push("");
    }
    const noted = results.agent.runs.filter((r) => r.judgement.notes.length > 0);
    if (noted.length > 0) {
      lines.push("### Notes", "");
      for (const run of noted) {
        for (const note of run.judgement.notes) {
          lines.push(`- Scenario ${run.scenario} run ${run.run}: ${note}.`);
        }
      }
      lines.push("");
    }
  }

  if (results.replies) {
    const first = results.replies.runs[0]?.summary;
    lines.push("## Reply classification", "");
    lines.push(
      `Accuracy ${pct(results.replies.accuracy)} over ${results.replies.runs.length} run(s) of ${first?.total ?? 0} replies.`,
      `Invalid JSON rate ${pct(results.replies.invalidJsonRate)}.`,
      `Mean latency ${results.replies.meanLatencyMs} ms.`,
    );
    if (first) {
      lines.push(
        `Latency of the first run: median ${first.latencyMs.median} ms, 95th percentile ${first.latencyMs.p95} ms, max ${first.latencyMs.max} ms.`,
        `Answers outside the schema: ${first.invalidSchema}. Requests that failed or timed out: ${first.otherFailures}.`,
      );
      if (first.requestedFieldsAccuracy !== null) {
        lines.push(
          `Requested fields named exactly on verification replies: ${pct(first.requestedFieldsAccuracy)}.`,
        );
      }
      lines.push("", "| Class | Correct | Cases |", "|---|---|---|");
      for (const [name, entry] of Object.entries(first.perClass)) {
        lines.push(`| ${name} | ${entry.correct} | ${entry.cases} |`);
      }
      if (first.confusions.length > 0) {
        lines.push("", "Misclassified in the first run:");
        for (const c of first.confusions) {
          lines.push(`- ${c.id}: truth ${c.truth}, answered ${c.predicted ?? "nothing usable"}.`);
        }
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
