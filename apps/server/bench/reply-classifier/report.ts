import type { HeldoutEvaluation, SplitEvaluation } from "./evaluate.js";
import type { Gate } from "./metrics.js";

export type CandidateResult =
  | {
      id: string;
      description: string;
      hardware: string;
      status: "ran";
      dev: SplitEvaluation | null;
      heldout: HeldoutEvaluation | null;
    }
  | { id: string; description: string; status: "skipped"; reason: string }
  | { id: string; description: string; status: "failed"; reason: string };

export interface RunReport {
  startedAt: string;
  hardware: string;
  sources: string[];
  counts: { dev: number; heldout: number };
  /** Held-out ids that repeat a dev message word for word. */
  heldoutRepeatsOfDev: string[];
  results: CandidateResult[];
}

const pct = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const ms = (value: number | null) => (value === null ? "n/a" : `${value.toFixed(1)} ms`);
const fixed = (value: number) => value.toFixed(3);

function gateLine(gate: Gate | null, total: number): string {
  if (!gate) return "No confidence threshold reaches 95 percent precision.";
  return `Threshold ${gate.threshold.toFixed(3)}: ${pct(gate.accuracy)} accuracy on the ${gate.accepted} replies at or above it, ${gate.below} of ${total} below it.`;
}

function classTable(split: SplitEvaluation): string[] {
  const rows = split.perClass
    .filter((entry) => entry.support > 0 || entry.predicted > 0)
    .map(
      (entry) =>
        `| ${entry.label} | ${entry.support} | ${entry.predicted} | ${pct(entry.precision)} | ${pct(entry.recall)} | ${pct(entry.f1)} |`,
    );
  return [
    "| Class | Support | Predicted | Precision | Recall | F1 |",
    "|---|---|---|---|---|---|",
    ...rows,
  ];
}

function reliabilityTable(split: SplitEvaluation): string[] {
  const rows = split.reliability
    .filter((bin) => bin.count > 0)
    .map(
      (bin) =>
        `| ${bin.lower.toFixed(1)} to ${bin.upper.toFixed(1)} | ${bin.count} | ${pct(bin.meanConfidence)} | ${pct(bin.accuracy)} |`,
    );
  return ["| Confidence | Replies | Mean confidence | Accuracy |", "|---|---|---|---|", ...rows];
}

function candidateSection(result: CandidateResult): string[] {
  const lines = [`## ${result.id}`, "", `${result.description}.`, ""];
  if (result.status !== "ran") {
    lines.push(`${result.status === "skipped" ? "Skipped" : "Failed"}: ${result.reason}.`, "");
    return lines;
  }
  lines.push(`Hardware: ${result.hardware}.`, "");
  const held = result.heldout;
  if (held) {
    lines.push(
      "### Held-out",
      "",
      `${held.count} replies. Accuracy ${pct(held.accuracy)}, macro F1 ${pct(held.macroF1)}, expected calibration error ${fixed(held.ece)}.`,
      `By source: ${Object.entries(held.perSource)
        .map(([source, entry]) => `${source} ${pct(entry.accuracy)} of ${entry.count}`)
        .join(", ")}.`,
      `The rules decided ${pct(held.rulesShare)} of the replies without the model.`,
      `Latency per reply: p50 ${ms(held.latency.p50Ms)}, p95 ${ms(held.latency.p95Ms)}.`,
      `Latency of the model call alone: p50 ${ms(held.latency.modelP50Ms)}, p95 ${ms(held.latency.modelP95Ms)}.`,
      `Gate chosen on dev, applied here: ${gateLine(held.devGate, held.count)}`,
      `Gate chosen on held-out itself, which is optimistic: ${gateLine(held.ownGate, held.count)}`,
      "",
      ...classTable(held),
      "",
      ...reliabilityTable(held),
      "",
    );
    if (held.confusions.length > 0) {
      lines.push(
        "Most common mistakes, truth then answer:",
        "",
        ...held.confusions.map((entry) => `- ${entry.truth} as ${entry.label}: ${entry.count}`),
        "",
      );
    }
  }
  const dev = result.dev;
  if (dev) {
    lines.push(
      "### Dev",
      "",
      `${dev.count} replies. Accuracy ${pct(dev.accuracy)}, macro F1 ${pct(dev.macroF1)}, expected calibration error ${fixed(dev.ece)}.`,
      `Gate: ${gateLine(dev.ownGate, dev.count)}`,
      "",
    );
  }
  return lines;
}

function summaryTable(report: RunReport): string[] {
  const rows = report.results.map((result) => {
    if (result.status !== "ran" || !result.heldout) {
      return `| ${result.id} | ${result.status} | | | | | | |`;
    }
    const held = result.heldout;
    const gate = held.devGate;
    return `| ${result.id} | ran | ${pct(held.accuracy)} | ${pct(held.macroF1)} | ${fixed(held.ece)} | ${gate ? `${pct(gate.accuracy)} (${gate.below} below)` : "n/a"} | ${ms(held.latency.p50Ms)} | ${ms(held.latency.p95Ms)} |`;
  });
  return [
    "| Candidate | Status | Accuracy | Macro F1 | ECE | Accuracy at 95% gate (below) | p50 | p95 |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
  ];
}

/** Markdown with one sentence per line, as the repository keeps its prose. */
export function renderReport(report: RunReport): string {
  return [
    "# Reply classifier bench",
    "",
    `Run at ${report.startedAt}.`,
    `Hardware: ${report.hardware}.`,
    `Sources: ${report.sources.join(", ")}.`,
    `${report.counts.dev} dev replies and ${report.counts.heldout} held-out replies.`,
    `${report.heldoutRepeatsOfDev.length} held-out replies repeat a dev message word for word.`,
    "All data is synthetic.",
    "The headline figures are the held-out ones, and the 95 percent gate is chosen on dev.",
    "",
    "## Summary",
    "",
    ...summaryTable(report),
    "",
    ...report.results.flatMap(candidateSection),
  ].join("\n");
}
