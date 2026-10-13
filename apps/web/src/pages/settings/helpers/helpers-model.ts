import type { AgentSetupView, ProbeResult, SettingsView, WorkerStatus } from "@kickrocks/shared";
import type { StatusShape } from "../../../lib/status.js";
import { addressOf, PROBE_ERROR_WORDS } from "../agents/setup-model.js";
import { workerState } from "../model.js";

export type HelperState = "ok" | "off" | "missing" | "waiting" | "lost";

export const STATE_MARKS: Record<HelperState, { shape: StatusShape; attention: boolean }> = {
  ok: { shape: "disc", attention: false },
  off: { shape: "ring", attention: false },
  missing: { shape: "ring", attention: false },
  waiting: { shape: "ring", attention: false },
  lost: { shape: "triangle", attention: true },
};

export interface HelperReading {
  state: HelperState;
  word: string;
  /** Mono text under the name. With `lastSeenAt` set, the text is followed by that time. */
  detail: string;
  lastSeenAt?: string;
}

export function workerReading(
  enabled: boolean,
  status: WorkerStatus | null,
  now: number,
): HelperReading {
  if (!enabled) return { state: "off", word: "Off", detail: "" };
  const seen = workerState(status?.lastSeenAt ?? null, now);
  if (seen === "online" && status) {
    return { state: "ok", word: "Online", detail: "last seen", lastSeenAt: status.lastSeenAt };
  }
  if (seen === "offline" && status) {
    return { state: "lost", word: "Offline", detail: "last seen", lastSeenAt: status.lastSeenAt };
  }
  return { state: "missing", word: "Not found", detail: "no heartbeat yet" };
}

export function accessReading(mcp: SettingsView["mcp"]): HelperReading {
  return mcp.enabled
    ? { state: "ok", word: "On", detail: mcp.tokenSet ? "token set" : "no token yet" }
    : { state: "off", word: "Off", detail: "" };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** What one address answered, in the words a helper row uses. */
export function probedReading(probe: ProbeResult | undefined): HelperReading {
  if (!probe?.reachable) {
    const why = probe?.error ? PROBE_ERROR_WORDS[probe.error] : "not found";
    return {
      state: "missing",
      word: "Not found",
      detail: probe ? `${addressOf(probe.baseUrl)} ${why}` : "",
    };
  }
  return {
    state: "ok",
    word: "Found",
    detail: `${addressOf(probe.baseUrl)} · ${plural(probe.models.length, "model")}`,
  };
}

/** The Ollama the server uses for replies: the one that answered, else the only one tried. */
export function replyReading(view: AgentSetupView | undefined): HelperReading {
  if (!view) return { state: "waiting", word: "Checking", detail: "" };
  const { endpoints } = view.components.server;
  const answered = endpoints.find((endpoint) => endpoint.reachable);
  if (answered) return probedReading(answered);
  const only = endpoints.length === 1 ? endpoints[0] : undefined;
  return only ? probedReading(only) : { state: "missing", word: "Not found", detail: "" };
}

/** The Ollama the agent worker reports for itself. */
export function agentModelReading(view: AgentSetupView | undefined): HelperReading {
  if (!view) return { state: "waiting", word: "Checking", detail: "" };
  const worker = view.components.worker;
  if (!worker) return { state: "waiting", word: "Waiting", detail: "no agent worker yet" };
  const model = worker.status.model;
  if (model && model.provider !== "ollama") {
    return { state: "ok", word: "Hosted", detail: `${model.provider} · ${model.name}` };
  }
  const ollama = worker.ollama;
  if (!ollama) return { state: "waiting", word: "Waiting", detail: "not reported yet" };
  if (!ollama.reachable) {
    const why = ollama.error ? PROBE_ERROR_WORDS[ollama.error] : "nothing answered";
    return { state: "lost", word: "Not found", detail: `${addressOf(ollama.baseUrl)} ${why}` };
  }
  return {
    state: "ok",
    word: "Found",
    detail: `${addressOf(ollama.baseUrl)} · ${plural(ollama.models.length, "model")}`,
  };
}

export function triedAddresses(view: AgentSetupView | undefined): string {
  const tried = view?.components.server.endpoints.map((endpoint) => addressOf(endpoint.baseUrl));
  return tried && tried.length > 0 ? `Tried ${tried.join(", ")}` : "Nothing tried yet";
}

export const WORKER_COMMANDS = {
  browser: "docker compose --profile worker up -d worker",
  agent: "docker compose --profile agent up -d agent-worker",
} as const;

export const AGENT_GUIDE_URL = "https://github.com/NC1107/kick-rocks/blob/main/docs/agents.md";
