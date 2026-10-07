import {
  API_ROUTES,
  DATA_SOURCE_DETAILS,
  DataSourceId,
  type DataSourceInfo,
  ScheduleSettings,
  type SettingsPatch,
  type SettingsView,
} from "@kickrocks/shared";
import { sql } from "drizzle-orm";
import { invalidRequest } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import { definedOnly } from "../../core/objects.js";
import type { AppServices } from "../../services.js";

function viewOf({ settings, config }: AppServices): SettingsView {
  const llm = settings.get("llm");
  return {
    schedule: settings.get("schedule"),
    llm: llm ? { baseUrl: llm.baseUrl, model: llm.model, apiKeySet: llm.apiKey !== null } : null,
    mcp: {
      enabled: settings.get("mcp.enabled"),
      tokenSet: settings.get("mcp.tokenHash") !== null,
      url: `${config.publicUrl}/mcp`,
    },
    worker: {
      enabled: config.workerToken !== null,
      status: settings.get("worker.status"),
    },
  };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function applyPatch({ settings }: AppServices, patch: SettingsPatch): void {
  if (patch.schedule) {
    settings.set(
      "schedule",
      ScheduleSettings.parse({ ...settings.get("schedule"), ...definedOnly(patch.schedule) }),
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
    return viewOf(services);
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
