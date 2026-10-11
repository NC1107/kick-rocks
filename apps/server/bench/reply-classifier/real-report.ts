import type { ReplyClassification } from "@kickrocks/shared";
import { accuracy, macroF1, perClass } from "./metrics.js";
import type { NameScenario, RealOutcome } from "./real-run.js";

/** The classes whose misreading costs a person the most, in the order the table shows them. */
export const RECALL_CLASSES: readonly ReplyClassification[] = [
  "needs_form",
  "confirmation_link",
  "verification_required",
  "completed",
  "auto_ack",
];

export interface RealSummary {
  count: number;
  accuracy: number;
  macroF1: number;
  recall: Record<string, { hits: number; support: number }>;
  applied: number;
  appliedWrong: number;
  review: number;
}

export function summarize(outcomes: readonly RealOutcome[]): RealSummary {
  const stats = perClass(outcomes);
  const applied = outcomes.filter((outcome) => outcome.apply);
  return {
    count: outcomes.length,
    accuracy: accuracy(outcomes),
    macroF1: macroF1(stats),
    recall: Object.fromEntries(
      RECALL_CLASSES.map((label) => {
        const entry = stats.find((stat) => stat.label === label);
        const support = entry?.support ?? 0;
        return [label, { hits: Math.round((entry?.recall ?? 0) * support), support }];
      }),
    ),
    applied: applied.length,
    appliedWrong: applied.filter((outcome) => outcome.label !== outcome.truth).length,
    review: outcomes.length - applied.length,
  };
}

export interface ApproachResult {
  name: string;
  description: string;
  scenarios: Record<NameScenario, RealSummary>;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function recallCell(summary: RealSummary, label: string): string {
  const entry = summary.recall[label];
  if (!entry || entry.support === 0) return "n/a";
  return `${entry.hits}/${entry.support}`;
}

function table(results: readonly ApproachResult[], scenario: NameScenario): string[] {
  const head = [
    "| Approach | Accuracy | Macro F1 |",
    ...RECALL_CLASSES.map((label) => ` ${label} |`),
  ].join("");
  const rows = results.map((result) => {
    const summary = result.scenarios[scenario];
    const cells = RECALL_CLASSES.map((label) => ` ${recallCell(summary, label)} |`).join("");
    return `| ${result.name} | ${pct(summary.accuracy)} | ${pct(summary.macroF1)} |${cells} ${summary.applied} | ${summary.appliedWrong} | ${summary.review} |`;
  });
  return [
    `${head} Applied | Applied wrong | Review |`,
    `|---|---|---|${"---|".repeat(RECALL_CLASSES.length + 3)}`,
    ...rows,
  ];
}

export interface RealReport {
  startedAt: string;
  hardware: string;
  count: number;
  support: Record<string, number>;
  notes: string[];
  results: ApproachResult[];
}

export function renderRealReport(report: RealReport): string {
  const support = Object.entries(report.support)
    .map(([label, count]) => `${label} ${count}`)
    .join(", ");
  return [
    "# Reply classifier on real replies",
    "",
    `Run ${report.startedAt} on ${report.hardware}.`,
    `${report.count} labeled replies (${support}); ambiguous ones are left out.`,
    "",
    ...report.notes.map((note) => `- ${note}`),
    "",
    "Recall cells are hits over support. Applied is what the server would act on without a person, Applied wrong how many of those disagree with the label, and Review everything else.",
    "",
    "## The request carries the company name",
    "",
    "Each reply comes from the company's own domain with no thread headers, so only the sender ties it to the open request.",
    "",
    ...table(report.results, "named"),
    "",
    "## The request does not carry the company name",
    "",
    "The same replies, tied to the request by their sender alone, but the request is for a different company. The name gate holds any reply that does not name the request's target.",
    "",
    ...table(report.results, "unnamed"),
    "",
  ].join("\n");
}
