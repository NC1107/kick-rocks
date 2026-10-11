import { ALT_SCAN_SCENARIOS } from "./alt-scans.js";
import { DEV_EXTRA_REPLY_CASES } from "./dev-replies.js";
import { DEV_SCAN_SCENARIOS } from "./dev-scans.js";
import { HELDOUT_REPLY_CASES } from "./heldout/replies.js";
import { HELDOUT_SCAN_SCENARIOS } from "./heldout/scans.js";
import { REPLY_CASES, type ReplyCase } from "./reply-cases.js";
import { ORIGINAL_SCENARIOS, type Scenario } from "./scenarios.js";
import { STRESS_REMOVAL_SCENARIOS } from "./stress-removals.js";

export { HELDOUT_REPLY_CASES };

/**
 * Dev is for tuning prompts and tools. Held-out is for checking a result that tuning did not see.
 * Stress is neither: it is written in other markup and wording after the tuning, so it says how far
 * the worker's checks and refusals reach, but its authors had seen them and it cannot be called unseen.
 */
export type Split = "dev" | "heldout" | "stress";

export const DEV_SCENARIOS: Scenario[] = [...ORIGINAL_SCENARIOS, ...DEV_SCAN_SCENARIOS];
export const HELDOUT_SCENARIOS: Scenario[] = HELDOUT_SCAN_SCENARIOS;
export const STRESS_SCENARIOS: Scenario[] = [...ALT_SCAN_SCENARIOS, ...STRESS_REMOVAL_SCENARIOS];
export const ALL_SCENARIOS: Scenario[] = [...DEV_SCENARIOS, ...HELDOUT_SCENARIOS];

export const DEV_REPLY_CASES: ReplyCase[] = [...REPLY_CASES, ...DEV_EXTRA_REPLY_CASES];
export const ALL_REPLY_CASES: ReplyCase[] = [...DEV_REPLY_CASES, ...HELDOUT_REPLY_CASES];

export function scenariosFor(split: Split): Scenario[] {
  return split === "dev"
    ? DEV_SCENARIOS
    : split === "heldout"
      ? HELDOUT_SCENARIOS
      : STRESS_SCENARIOS;
}

export function replyCasesFor(split: Split): ReplyCase[] {
  return split === "dev" ? DEV_REPLY_CASES : split === "heldout" ? HELDOUT_REPLY_CASES : [];
}

export function scenarioById(id: number): Scenario {
  const found = [...ALL_SCENARIOS, ...STRESS_SCENARIOS].find((s) => s.id === id);
  if (!found) throw new Error(`There is no scenario ${id}`);
  return found;
}

/** Which split a scenario belongs to, for reports that list scenarios from either. */
export function splitOfScenario(id: number): Split {
  if (STRESS_SCENARIOS.some((s) => s.id === id)) return "stress";
  return HELDOUT_SCENARIOS.some((s) => s.id === id) ? "heldout" : "dev";
}
