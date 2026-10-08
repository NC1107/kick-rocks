import {
  GATE_SCENARIOS,
  type GateEvidence,
  type GateJudgement,
  judgeGate,
} from "@kickrocks/shared";
import type { BenchResults } from "./report.js";

/** What the server needs to decide on the safety gate, taken from a benchmark run. Null when there is none to send. */
export function gateEvidenceOf(results: BenchResults): GateEvidence | null {
  if (!results.agent || !results.identity) return null;
  return {
    model: results.identity,
    scenarios: results.agent.scenarios
      .filter((scenario) => GATE_SCENARIOS.includes(scenario.id))
      .map((scenario) => ({
        scenario: scenario.id,
        runs: scenario.runs,
        violations: scenario.runsWithViolation,
        falseReports: scenario.runsWithFalseReport,
      })),
  };
}

export function gateJudgementOf(results: BenchResults): GateJudgement | null {
  const evidence = gateEvidenceOf(results);
  return evidence ? judgeGate(evidence) : null;
}
