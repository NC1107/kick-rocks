import { existsSync } from "node:fs";
import { findInstalledChrome } from "@kickrocks/worker/dist/browser.js";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { runBench } from "./bench.js";
import type { BenchResults } from "./report.js";
import { SCENARIOS } from "./scenarios.js";

const browserAvailable =
  findInstalledChrome() !== null ||
  Boolean(process.env.KICKROCKS_CHROME_EXECUTABLE) ||
  existsSync(chromium.executablePath());

const describeBrowser = describe.skipIf(
  !browserAvailable && process.env.KICKROCKS_REQUIRE_INTEGRATION !== "1",
);

const TWO_MINUTES = 120_000;

describeBrowser("benchmark harness", () => {
  it(
    "scores a perfect scripted model at 100 percent with no violations",
    async () => {
      const results = await runBench({
        model: "fake-perfect",
        fake: "perfect",
        runs: 1,
        agent: true,
        replies: true,
      });
      const agent = requireAgent(results);
      expect(agent.runs).toHaveLength(SCENARIOS.length);
      expect(agent.runs.filter((r) => !r.success).map((r) => r.judgement.failure)).toEqual([]);
      expect(agent.totals.successRate).toBe(1);
      expect(agent.totals.runsWithViolation).toBe(0);
      expect(results.replies?.accuracy).toBe(1);
      expect(results.replies?.invalidJsonRate).toBe(0);
    },
    TWO_MINUTES,
  );

  it(
    "registers the mistakes of a deliberately bad scripted model",
    async () => {
      const results = await runBench({
        model: "fake-bad",
        fake: "bad",
        runs: 1,
        agent: true,
        replies: true,
      });
      const agent = requireAgent(results);
      const kinds = new Set(agent.runs.flatMap((r) => r.judgement.violations.map((v) => v.kind)));
      expect([...kinds].sort()).toEqual([
        "guessed_value",
        "off_scope_navigation",
        "second_submit",
        "submit_when_blocked",
        "unlisted_field",
        "unlisted_value_sent",
      ]);
      expect(agent.totals.runsWithLeakedViolation).toBeGreaterThan(0);
      expect(agent.totals.successRate).toBeLessThan(0.5);
      expect(results.replies?.invalidJsonRate).toBeGreaterThan(0);
      expect(results.replies?.accuracy).toBe(0);
    },
    TWO_MINUTES,
  );
});

function requireAgent(results: BenchResults): NonNullable<BenchResults["agent"]> {
  if (!results.agent) throw new Error("The agent half of the benchmark did not run");
  return results.agent;
}
