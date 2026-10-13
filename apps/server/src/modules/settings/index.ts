import { targets } from "@kickrocks/db";
import {
  API_ROUTES,
  canonicalModelName,
  DATA_SOURCE_DETAILS,
  DataSourceId,
  type DataSourceInfo,
  EgressSettings,
  GpuMemoryAnswers,
  gateVerdict,
  RetentionSettings,
  ScanningSettings,
  ScheduleSettings,
  type SettingsPatch,
  type SettingsView,
  type WorkerStatus,
  withOverride,
} from "@kickrocks/shared";
import { eq, sql } from "drizzle-orm";
import { nowIso } from "../../core/clock.js";
import { createEgressRouter } from "../../core/egress.js";
import { conflict, invalidRequest } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import { definedOnly } from "../../core/objects.js";
import { ownerKeyOfRow } from "../../core/site-politeness.js";
import type { AppServices } from "../../services.js";
import { applyRetention } from "../data-rights/index.js";
import { acceptLikelyMatches } from "../review/decisions.js";
import { buildAgentSetup } from "./agent-setup.js";
import { probeOllama } from "./ollama-probe.js";

function viewOf(services: AppServices): SettingsView {
  const { settings, config } = services;
  const llm = settings.get("llm");
  const egress = settings.get("egress");
  const router = createEgressRouter(services);
  const records = settings.get("agent.gate").records;
  const model = services.claimers.latestWorker("model");
  const reported = model?.model ?? null;
  return {
    schedule: settings.get("schedule"),
    retention: settings.get("retention"),
    scanning: settings.get("scanning"),
    egress,
    egressCoverage: Object.fromEntries(
      egress.domains.map((domain) => [domain, router.sistersOf(domain)]),
    ),
    llm: llm ? { baseUrl: llm.baseUrl, model: llm.model, apiKeySet: llm.apiKey !== null } : null,
    replyModel: services.replyPredictions.view(services.replyModel.status()),
    mcp: {
      enabled: settings.get("mcp.enabled"),
      tokenSet: settings.get("mcp.tokenHash") !== null,
      url: `${config.publicUrl}/mcp`,
    },
    siteChecks: { enabled: settings.get("siteChecks.enabled") },
    agent: {
      takeUnreviewed: settings.get("agent.takeUnreviewed"),
      approvalHoldMinutes: settings.get("agent.approvalHoldMinutes"),
      autopilot: settings.get("agent.autopilot"),
      model: settings.get("agent.model"),
      gpuMemoryGb: settings.get("agent.gpuMemoryGb"),
      gate: {
        records,
        current: reported ? { model: reported, verdict: gateVerdict(records, reported) } : null,
      },
    },
    worker: {
      enabled: config.workerToken !== null,
      builtin: withCurrentTask(services, services.claimers.latestWorker("builtin")),
      model: withCurrentTask(services, model),
    },
  };
}

/**
 * The first live target counted under each domain the settings page mentions: the sites that
 * were visited, the ones routed through a proxy, and the sister sites that route also covers.
 */
function targetsByDomain(
  services: AppServices,
  items: readonly { domain: string }[],
): Record<string, string> {
  const router = createEgressRouter(services);
  const routed = services.settings.get("egress").domains;
  const wanted = new Set([
    ...items.map((site) => site.domain),
    ...routed,
    ...routed.flatMap((domain) => router.sistersOf(domain)),
  ]);
  const found: Record<string, string> = {};
  const rows = services.db
    .select({ id: targets.id, domain: targets.domain, data: targets.data })
    .from(targets)
    .where(eq(targets.retired, false))
    .orderBy(targets.id)
    .all();
  for (const row of rows) {
    for (const key of [row.domain, ownerKeyOfRow(row)]) {
      if (wanted.has(key) && found[key] === undefined) found[key] = row.id;
    }
  }
  return found;
}

function withCurrentTask(
  { taskQueue }: AppServices,
  status: WorkerStatus | null,
): WorkerStatus | null {
  if (status === null || status.currentTaskId === null) return status;
  const task = taskQueue.get(status.currentTaskId);
  const [summary] = task ? taskQueue.summarize([task]) : [];
  if (!summary) return status;
  const { id, kind, status: taskStatus, requestId, targetId, targetName } = summary;
  return {
    ...status,
    currentTask: { id, kind, status: taskStatus, requestId, targetId, targetName },
  };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function applyPatch(services: AppServices, patch: SettingsPatch): void {
  const { settings, clock, claimers } = services;
  if (patch.schedule) {
    settings.set(
      "schedule",
      ScheduleSettings.parse({ ...settings.get("schedule"), ...definedOnly(patch.schedule) }),
    );
  }
  if (patch.retention) {
    settings.set(
      "retention",
      RetentionSettings.parse({
        ...settings.get("retention"),
        ...definedOnly(patch.retention),
      }),
    );
  }
  if (patch.scanning) {
    settings.set(
      "scanning",
      ScanningSettings.parse({ ...settings.get("scanning"), ...definedOnly(patch.scanning) }),
    );
  }
  if (patch.egress) {
    settings.set(
      "egress",
      EgressSettings.parse({ ...settings.get("egress"), ...definedOnly(patch.egress) }),
    );
  }
  if (patch.llm === null) {
    settings.reset("llm");
  } else if (patch.llm) {
    const { baseUrl, model, apiKey } = patch.llm;
    const stored = settings.get("llm");
    if (apiKey === undefined && stored?.apiKey && !sameOrigin(stored.baseUrl, baseUrl)) {
      throw invalidRequest("The saved API key is for a different server", [
        {
          path: ["body", "llm", "apiKey"],
          message: "The endpoint changed, so enter the API key again",
        },
      ]);
    }
    // An omitted key keeps the stored one, so editing the model does not mean typing the key again.
    const kept = apiKey === undefined ? (stored?.apiKey ?? null) : apiKey;
    settings.set("llm", { baseUrl, model, apiKey: kept });
  }
  if (patch.mcp) settings.set("mcp.enabled", patch.mcp.enabled);
  if (patch.siteChecks) settings.set("siteChecks.enabled", patch.siteChecks.enabled);
  if (patch.agent?.takeUnreviewed !== undefined) {
    settings.set("agent.takeUnreviewed", patch.agent.takeUnreviewed);
  }
  if (patch.agent?.approvalHoldMinutes !== undefined) {
    settings.set("agent.approvalHoldMinutes", patch.agent.approvalHoldMinutes);
  }
  if (patch.agent?.autopilot !== undefined) {
    settings.set("agent.autopilot", patch.agent.autopilot);
    // The records already waiting were scored before the person stopped wanting to be asked.
    if (patch.agent.autopilot) acceptLikelyMatches(services);
  }
  if (patch.agent?.model === null) {
    settings.reset("agent.model");
  } else if (patch.agent?.model) {
    const wanted = canonicalModelName(patch.agent.model.name);
    const listed = claimers.latestWorker("model")?.ollama?.models ?? [];
    if (!listed.some((model) => canonicalModelName(model.name) === wanted)) {
      throw conflict(
        "model_not_installed",
        `The agent worker's Ollama does not list ${patch.agent.model.name}`,
      );
    }
    settings.set("agent.model", patch.agent.model);
  }
  if (patch.agent?.gpuMemoryGb) {
    settings.set(
      "agent.gpuMemoryGb",
      GpuMemoryAnswers.parse({
        ...settings.get("agent.gpuMemoryGb"),
        ...definedOnly(patch.agent.gpuMemoryGb),
      }),
    );
  }
  if (patch.agent?.gateOverride) {
    const { provider, name, enabled } = patch.agent.gateOverride;
    settings.set("agent.gate", {
      records: withOverride(
        settings.get("agent.gate").records,
        { provider, name },
        enabled,
        nowIso(clock),
      ),
    });
  }
}

/** How many live targets list each source, counting a target once however it lists it. */
function targetCountsBySource({ db }: AppServices): Map<string, number> {
  const rows = db.all<{ source: string; total: number }>(sql`
    select json_extract(entry.value, '$.source') as source, count(distinct targets.id) as total
    from targets, json_each(targets.data, '$.sources') as entry
    where targets.retired = 0
    group by source
  `);
  return new Map(rows.map((row) => [row.source, row.total]));
}

export const settingsModule: ModulePlugin = (app, services) => {
  const { db, secrets, legal } = services;

  registerRoute(app, API_ROUTES.settingsGet, () => viewOf(services));

  registerRoute(app, API_ROUTES.settingsPatch, ({ body }) => {
    db.transaction(() => applyPatch(services, body));
    // A shorter window should take effect now, not at the scheduler's next pass.
    if (body.retention) applyRetention(services);
    return viewOf(services);
  });

  registerRoute(app, API_ROUTES.settingsAgentSetup, ({ query }) =>
    buildAgentSetup(services, query.ask ?? null),
  );

  registerRoute(app, API_ROUTES.settingsAgentSetupProbe, ({ body }) =>
    probeOllama(services.probeFetch, { baseUrl: body.baseUrl, source: "asked" }),
  );

  registerRoute(app, API_ROUTES.replyModelLabels, ({ reply }) => {
    reply.header("content-disposition", 'attachment; filename="kickrocks-reply-labels.jsonl"');
    return {
      contentType: "application/x-ndjson",
      data: Buffer.from(services.replyPredictions.exportLabels(), "utf8"),
    };
  });

  registerRoute(app, API_ROUTES.settingsSites, () => {
    const status = services.politeness.status();
    return { ...status, targets: targetsByDomain(services, status.items) };
  });

  registerRoute(app, API_ROUTES.settingsMcpToken, ({ reply }) => {
    reply.header("cache-control", "no-store");
    return { token: secrets.rotateMcpToken() };
  });

  registerRoute(app, API_ROUTES.settingsJurisdictions, () => ({
    jurisdictions: legal.listJurisdictions(),
  }));

  registerRoute(app, API_ROUTES.settingsDataSources, () => {
    const counts = targetCountsBySource(services);
    const sources: DataSourceInfo[] = DataSourceId.options.map((id) => ({
      id,
      ...DATA_SOURCE_DETAILS[id],
      targetCount: counts.get(id) ?? 0,
    }));
    return { sources };
  });
};
