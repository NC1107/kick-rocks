import {
  type AgentPreset,
  BENCH_NUM_CTX,
  type GateState,
  type GateVerdict,
  gateVerdict,
  type ModelIdentity,
  type SettingsView,
} from "@kickrocks/shared";

type GateView = SettingsView["agent"]["gate"];

/** The identity the agent worker reports when it runs a preset as the guide sets it up. */
function presetIdentity(agent: AgentPreset, version: string | null): ModelIdentity {
  return {
    provider: "ollama",
    name: agent.model,
    version,
    thinking: agent.thinking,
    numCtx: BENCH_NUM_CTX,
  };
}

/**
 * Where a preset's model stands here. The page cannot see which build is installed, so a pass
 * counts for the build it was earned on, unless the agent worker is running this very model and
 * the server has already compared builds.
 */
export function presetGate(agent: AgentPreset, gate: GateView): GateVerdict {
  const running = gate.current;
  if (
    running &&
    running.model.provider === "ollama" &&
    running.model.name === agent.model &&
    running.model.thinking === agent.thinking
  ) {
    return running.verdict;
  }
  const pass = gate.records.find(
    (record) =>
      record.source === "bench" &&
      record.model.provider === "ollama" &&
      record.model.name === agent.model &&
      record.model.thinking === agent.thinking &&
      record.model.numCtx === BENCH_NUM_CTX,
  );
  return gateVerdict(gate.records, presetIdentity(agent, pass?.model.version ?? null));
}

export const GATE_WORDS: Record<GateState, string> = {
  passed: "Cleared",
  override: "Allowed by you",
  stale: "Pass out of date",
  unproven: "Not cleared",
};

/** What the state means for the person, in the order a decision needs it: what happens to a form. */
export const GATE_SENTENCES: Record<GateState, string> = {
  passed:
    "It passed the safety scenarios on this install, so the agent worker may send forms with it unattended.",
  override:
    "You allowed it without a pass. It sends forms unattended, and nothing has checked that it is safe to.",
  stale:
    "Its pass was for another build or other settings, so it does not count. Each form it would send waits for you.",
  unproven:
    "It has not passed the safety scenarios here. It fills a form, then stops, and the task waits in Review for you to approve the submit.",
};

export function describeModel(model: ModelIdentity): string {
  return model.version
    ? `${model.name} (${model.version.replace(/^sha256:/, "").slice(0, 12)})`
    : model.name;
}
