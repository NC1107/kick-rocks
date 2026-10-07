import { matches, profiles, scans, targets, tasks } from "@kickrocks/db";
import { API_ROUTES, needsRecord, type ScanSummary, type TargetOutcome } from "@kickrocks/shared";
import { count, desc, eq, inArray, sql } from "drizzle-orm";
import { notFound } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import type { AppServices } from "../../services.js";

const skipped = (
  target: { id: string; name: string },
  reason: NonNullable<TargetOutcome["reason"]>,
  detail: string | null,
  scanId: string | null = null,
): TargetOutcome => ({
  targetId: target.id,
  targetName: target.name,
  outcome: "skipped",
  requestId: null,
  scanId,
  reason,
  detail,
});

function requireProfile(services: AppServices, profileId: string): void {
  const found = services.db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .get();
  if (!found) throw notFound(`Profile ${profileId} not found`, "profile_not_found");
}

/** The targets a scan request names, checked up front so one unknown id fails the whole request. */
function targetsToScan(
  services: AppServices,
  selection: { targetIds: string[] } | { preset: string },
) {
  if ("preset" in selection) {
    return services.db
      .select()
      .from(targets)
      .all()
      .filter((row) => !row.retired && needsRecord(row));
  }
  const ids = [...new Set(selection.targetIds)];
  const rows = services.db.select().from(targets).where(inArray(targets.id, ids)).all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = ids.find((id) => !byId.has(id));
  if (missing) throw notFound(`Target ${missing} not found`, "target_not_found");
  return ids.map((id) => byId.get(id) as (typeof rows)[number]);
}

function startScans(
  services: AppServices,
  profileId: string,
  selection: Parameters<typeof targetsToScan>[1],
) {
  return targetsToScan(services, selection).map((row): TargetOutcome => {
    if (row.retired) {
      return skipped(row, "unsupported_channel", `${row.name} is no longer in the dataset.`);
    }
    if (!needsRecord(row)) {
      return skipped(
        row,
        "unsupported_channel",
        `${row.name} does not list people, so there is nothing to scan. Send it a request instead.`,
      );
    }
    const result = services.dispatch.enqueueScan(profileId, row.id);
    if (!result.created) {
      return skipped(row, "scan_in_progress", null, result.scanId);
    }
    return {
      targetId: row.id,
      targetName: row.name,
      outcome: "scan_started",
      requestId: null,
      scanId: result.scanId,
      reason: null,
      detail: null,
    };
  });
}

export const scansModule: ModulePlugin = (app, services) => {
  registerRoute(app, API_ROUTES.scansStart, ({ params, body }) => {
    requireProfile(services, params.id);
    return { items: startScans(services, params.id, body) };
  });

  registerRoute(app, API_ROUTES.scansList, ({ params, query }) => {
    requireProfile(services, params.id);
    const where = eq(scans.profileId, params.id);
    const total = services.db.select({ n: count() }).from(scans).where(where).get()?.n ?? 0;
    const rows = services.db
      .select({
        scan: scans,
        targetName: targets.name,
        taskStatus: tasks.status,
      })
      .from(scans)
      .innerJoin(targets, eq(scans.targetId, targets.id))
      .leftJoin(tasks, eq(scans.taskId, tasks.id))
      .where(where)
      .orderBy(desc(scans.startedAt), desc(sql`${scans}.rowid`))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .all();

    const counts = new Map<string, ScanSummary["matchCounts"]>();
    if (rows.length > 0) {
      const grouped = services.db
        .select({ scanId: matches.scanId, decision: matches.decision, n: count() })
        .from(matches)
        .where(
          inArray(
            matches.scanId,
            rows.map((row) => row.scan.id),
          ),
        )
        .groupBy(matches.scanId, matches.decision)
        .all();
      for (const { scanId, decision, n } of grouped) {
        const current = counts.get(scanId) ?? { pending: 0, mine: 0, not_mine: 0 };
        current[decision] = n;
        counts.set(scanId, current);
      }
    }

    return {
      items: rows.map(({ scan, targetName, taskStatus }) => ({
        id: scan.id,
        profileId: scan.profileId,
        targetId: scan.targetId,
        targetName,
        taskId: scan.taskId,
        taskStatus,
        startedAt: scan.startedAt,
        finishedAt: scan.finishedAt,
        candidateCount: scan.candidates?.length ?? 0,
        matchCounts: counts.get(scan.id) ?? { pending: 0, mine: 0, not_mine: 0 },
        error: scan.error,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  });
};
