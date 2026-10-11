import {
  type AgentSetupView,
  agentSetupCandidates,
  composeAgentSetup,
  type ProbeResult,
} from "@kickrocks/shared";
import type { AppServices } from "../../services.js";
import { probeOllama } from "./ollama-probe.js";

export async function buildAgentSetup(
  services: AppServices,
  ask: string | null,
): Promise<AgentSetupView> {
  const { settings, probeFetch } = services;
  const worker = services.claimers.latestWorker("model");

  const llm = settings.get("llm");
  const candidates = agentSetupCandidates({
    ask,
    savedBaseUrl: llm?.baseUrl ?? null,
    workerBaseUrl: worker?.ollama?.baseUrl ?? null,
  });
  const endpoints: ProbeResult[] = await Promise.all(
    candidates.map((candidate) =>
      probeOllama(probeFetch, {
        ...candidate,
        // The key belongs to the saved endpoint alone.
        apiKey: candidate.source === "saved" ? (llm?.apiKey ?? null) : null,
      }),
    ),
  );
  return composeAgentSetup({
    worker,
    endpoints,
    answers: settings.get("agent.gpuMemoryGb"),
    gateRecords: settings.get("agent.gate").records,
  });
}
