import type { GateState, ModelIdentity } from "@kickrocks/shared";

export const GATE_WORDS: Record<GateState, string> = {
  passed: "Cleared",
  override: "Allowed by you",
  stale: "Pass out of date",
  unproven: "Not cleared",
};

/** What the state means for the person, in the order a decision needs it: what happens to a form. */
export const GATE_SENTENCES: Record<GateState, string> = {
  passed:
    "It passed the safety gate on this install, so the agent worker may send forms with it unattended.",
  override:
    "You allowed it without a pass. It sends forms unattended, and nothing has checked that it is safe to.",
  stale:
    "Its pass was for another build or other settings, so it does not count. Every request carrying a contact detail, and every body sent to the site once the run starts typing, waits for you.",
  unproven:
    "It has not passed the safety gate here. Every request carrying a contact detail, and every body sent to the site once the run starts typing, waits for you in Review, with the page as it stood.",
};

export function describeModel(model: ModelIdentity): string {
  return model.version
    ? `${model.name} (${model.version.replace(/^sha256:/, "").slice(0, 12)})`
    : model.name;
}

/** How long a held send waits for the person before the run gives up on it, as the setting offers it. */
export const HOLD_CHOICES: readonly { minutes: number; label: string }[] = [
  { minutes: 0, label: "Never wait, approve in Review afterwards" },
  { minutes: 2, label: "2 minutes" },
  { minutes: 10, label: "10 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
];

/** The choices, with the saved value among them even when it is one this list did not plan for. */
export function holdChoicesFor(minutes: number): readonly { minutes: number; label: string }[] {
  if (HOLD_CHOICES.some((choice) => choice.minutes === minutes)) return HOLD_CHOICES;
  return [...HOLD_CHOICES, { minutes, label: `${minutes} minutes` }].sort(
    (a, b) => a.minutes - b.minutes,
  );
}
