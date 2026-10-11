import {
  type AgentModelChoice,
  type AgentSetupView,
  type GateState,
  normalizeOllamaUrl,
  type ProbeError,
  type SettingsPatch,
  type SettingsView,
} from "@kickrocks/shared";

type WorkerPart = NonNullable<AgentSetupView["components"]["worker"]>;

/** `desktop:11434`, the part of an address a person recognises. */
export function addressOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function gigabytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return `${gb >= 100 ? Math.round(gb) : Math.round(gb * 10) / 10} GB`;
}

export function contextWords(numCtx: number): string {
  return `${Math.round(numCtx / 1024)}k context`;
}

export const PROBE_ERROR_WORDS: Record<ProbeError, string> = {
  unreachable: "nothing answered",
  timeout: "no answer in time",
  bad_response: "it answered, but not like Ollama",
  redirect: "it redirected, which is refused",
  too_large: "its answer was too large",
};

/** What the agent worker's GPU reading says, in the words of the detection row. */
export function workerGpuWords(worker: WorkerPart): string {
  const gpus = worker.host?.gpus;
  if (gpus && gpus.length > 0) {
    const first = gpus[0];
    return first
      ? `${first.name.replace(/^NVIDIA GeForce /, "")} ${gigabytes(first.memoryBytes)}`
      : "";
  }
  if (!worker.host) return "machine not reported";
  if (worker.host.gpuProbe === "ok") return "no GPU found";
  if (worker.host.gpuProbe === "failed") return "GPU check failed";
  return "GPU not visible to the worker";
}

/** The gate sentence on the recommendation, short enough for one line. */
export const GATE_LINES: Record<GateState, string> = {
  passed: "Cleared here, so the agent worker may send forms on its own",
  override: "Allowed by you, nothing has checked that it is safe",
  stale: "Pass out of date: each send waits for you in Review",
  unproven: "Not cleared yet: each send waits for you in Review",
};

function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!(a && b)) return false;
  return normalizeOllamaUrl(a) === normalizeOllamaUrl(b);
}

export interface ApplyPlan {
  /** The reply endpoint and model to save, or null when there is nothing to save for replies. */
  llm: NonNullable<SettingsPatch["llm"]> | null;
  /** The agent model to hand to the worker, or null when the worker cannot take one. */
  agentModel: AgentModelChoice | null;
  replyApplied: boolean;
  agentApplied: boolean;
  /** Whether the agent worker can be given the model from here, or the person has to copy settings. */
  agentFromHere: boolean;
  /** An agent model exists to recommend, whichever way it gets to the worker. */
  hasAgent: boolean;
  hasReply: boolean;
  /** Everything this screen can do is already saved. */
  allApplied: boolean;
}

/** What Apply would save, and how much of the recommendation is already saved. */
export function planApply(view: AgentSetupView, settings: SettingsView): ApplyPlan {
  const { agent, reply } = view.recommendation;
  const worker = view.components.worker;

  const replyEndpoint = view.replyEndpoint;
  const hasReply = reply !== null && replyEndpoint !== null;
  const replyApplied =
    hasReply &&
    settings.llm?.model === reply.name &&
    sameAddress(settings.llm.baseUrl, replyEndpoint);
  let llm: ApplyPlan["llm"] = null;
  if (hasReply && !replyApplied) {
    const savedOrigin = settings.llm ? normalizeOllamaUrl(settings.llm.baseUrl) : null;
    const keepsKey = savedOrigin !== null && sameOrigin(savedOrigin, replyEndpoint);
    llm = {
      baseUrl: `${replyEndpoint}/v1`,
      model: reply.name,
      // A key saved for another server must not follow the endpoint to a new one.
      ...(settings.llm?.apiKeySet && !keepsKey ? { apiKey: null } : {}),
    };
  }

  const agentFromHere =
    agent !== null && worker?.acceptsAgentModel === true && worker.ollama?.reachable === true;
  const choice: AgentModelChoice | null = agent
    ? { name: agent.name, thinking: agent.thinking, numCtx: agent.numCtx }
    : null;
  const saved = settings.agent.model;
  const agentApplied =
    choice !== null &&
    saved !== null &&
    saved.name === choice.name &&
    saved.thinking === choice.thinking &&
    saved.numCtx === choice.numCtx;

  const replyDone = !hasReply || replyApplied;
  const agentDone = !agentFromHere || agentApplied;
  return {
    llm,
    agentModel: agentFromHere && !agentApplied ? choice : null,
    replyApplied,
    agentApplied,
    agentFromHere,
    hasAgent: agent !== null,
    hasReply,
    allApplied: replyDone && agentDone && (hasReply || agentFromHere),
  };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** The body of the one PATCH that Apply sends. */
export function applyBody(plan: ApplyPlan): SettingsPatch {
  return {
    ...(plan.llm ? { llm: plan.llm } : {}),
    ...(plan.agentModel ? { agent: { model: plan.agentModel } } : {}),
  };
}

/** The agent worker's reported model differs from the one saved, so it has not switched yet. */
export function workerLags(view: AgentSetupView, settings: SettingsView): boolean {
  const worker = view.components.worker;
  const saved = settings.agent.model;
  if (!(worker?.acceptsAgentModel && saved)) return false;
  const reported = worker.status.model;
  return !(
    reported &&
    reported.provider === "ollama" &&
    reported.name === saved.name &&
    reported.numCtx === saved.numCtx
  );
}
