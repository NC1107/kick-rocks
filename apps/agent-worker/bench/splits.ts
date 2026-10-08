import { DEV_EXTRA_REPLY_CASES } from "./dev-replies.js";
import { DEV_SCAN_SCENARIOS } from "./dev-scans.js";
import { HELDOUT_REPLY_CASES } from "./heldout/replies.js";
import { HELDOUT_SCAN_SCENARIOS } from "./heldout/scans.js";
import { REPLY_CASES, type ReplyCase } from "./reply-cases.js";
import { ORIGINAL_SCENARIOS, type Scenario } from "./scenarios.js";

export { HELDOUT_REPLY_CASES };

/** Dev is for tuning prompts and tools. Held-out is for checking a result that tuning did not see. */
export type Split = "dev" | "heldout";

export const DEV_SCENARIOS: Scenario[] = [...ORIGINAL_SCENARIOS, ...DEV_SCAN_SCENARIOS];
export const HELDOUT_SCENARIOS: Scenario[] = HELDOUT_SCAN_SCENARIOS;
export const ALL_SCENARIOS: Scenario[] = [...DEV_SCENARIOS, ...HELDOUT_SCENARIOS];

export const DEV_REPLY_CASES: ReplyCase[] = [...REPLY_CASES, ...DEV_EXTRA_REPLY_CASES];
export const ALL_REPLY_CASES: ReplyCase[] = [...DEV_REPLY_CASES, ...HELDOUT_REPLY_CASES];

export function scenariosFor(split: Split): Scenario[] {
  return split === "dev" ? DEV_SCENARIOS : HELDOUT_SCENARIOS;
}

export function replyCasesFor(split: Split): ReplyCase[] {
  return split === "dev" ? DEV_REPLY_CASES : HELDOUT_REPLY_CASES;
}

export function scenarioById(id: number): Scenario {
  const found = ALL_SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`There is no scenario ${id}`);
  return found;
}

/** Which split a scenario belongs to, for reports that list scenarios from either. */
export function splitOfScenario(id: number): Split {
  return HELDOUT_SCENARIOS.some((s) => s.id === id) ? "heldout" : "dev";
}
