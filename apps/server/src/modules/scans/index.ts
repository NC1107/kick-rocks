import { matches, scans, targets, tasks } from "@kickrocks/db";
import {
  API_ROUTES,
  needsRecord,
  type ScanStartBody,
  type ScanSummary,
  type TargetOutcome,
} from "@kickrocks/shared";
import { count, desc, eq, inArray, sql } from "drizzle-orm";
import { notFound } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import { buildListingDetail, buildListings, summarizeListings } from "../../core/listings.js";
import type { ModulePlugin } from "../../core/module.js";
import { identityVariantsFor } from "../../core/past-addresses.js";
import { requireProfile } from "../../core/require-profile.js";
import {
  describeMissingScanFields,
  missingScanFields,
  scanHold,
} from "../../core/scan-readiness.js";
import { scanDropReason, siteChoiceDetail } from "../../core/scan-skips.js";
import { scanToday } from "../../core/scan-today.js";
import { selectByFilter } from "../../core/target-selection.js";
import { isPeopleSearchTarget } from "../../core/targets.js";
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

/** The targets a scan request names, checked up front so one unknown id fails the whole request. */
function targetsToScan(services: AppServices, selection: ScanStartBody) {
  if ("filter" in selection) return selectByFilter(services.targets, selection.filter);
  if ("preset" in selection) {
    return services.db
      .select()
      .from(targets)
      .all()
      .filter((row) => !row.retired && isPeopleSearchTarget(row));
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
  const named = "targetIds" in selection;
  const today = scanToday(services);
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
    const missing = missingScanFields(services, profileId, row.id);
    if (missing.length > 0) {
      return skipped(
        row,
        "missing_profile_details",
        `Add ${describeMissingScanFields(missing)} to this profile to scan ${row.name}.`,
      );
    }
    const dropped = scanDropReason(services.scanPreferences.blocks(profileId, row.id), named);
    if (dropped) return skipped(row, dropped, siteChoiceDetail(dropped, row.name));
    const result = services.dispatch.enqueueScan(profileId, row.id);
    const includePast =
      selection.addresses === "all" ||
      (selection.addresses === undefined &&
        services.scanPreferences.get(profileId, row.id).includePastAddresses);
    const variantsStarted = includePast
      ? identityVariantsFor(services, profileId, today).filter(
          (variant) => services.dispatch.enqueueScan(profileId, row.id, variant).created,
        ).length
      : 0;
    if (!result.created && variantsStarted === 0) {
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

function requireListing(services: AppServices, profileId: string, targetId: string) {
  const detail = buildListingDetail(services, profileId, targetId);
  if (!detail) throw notFound(`Target ${targetId} not found`, "target_not_found");
  return detail;
}

export const scansModule: ModulePlugin = (app, services) => {
  registerRoute(app, API_ROUTES.scansStart, ({ params, body }) => {
    requireProfile(services.db, params.id);
    return { items: startScans(services, params.id, body) };
  });

  registerRoute(app, API_ROUTES.listingsList, ({ params, query }) => {
    requireProfile(services.db, params.id);
    const sites = buildListings(services, params.id);
    const wanted = query.status ? new Set(query.status) : null;
    const kept = wanted ? sites.filter((site) => wanted.has(site.status)) : sites;
    return {
      ...summarizeListings(sites, services.clock.now()),
      items: kept.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      total: kept.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  });

  registerRoute(app, API_ROUTES.listingsGet, ({ params }) => {
    requireProfile(services.db, params.id);
    return requireListing(services, params.id, params.targetId);
  });

  registerRoute(app, API_ROUTES.listingsPreference, ({ params, body }) => {
    requireProfile(services.db, params.id);
    requireListing(services, params.id, params.targetId);
    services.scanPreferences.set(params.id, params.targetId, body);
    return requireListing(services, params.id, params.targetId);
  });

  registerRoute(app, API_ROUTES.scansList, ({ params, query }) => {
    requireProfile(services.db, params.id);
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
        hold: scanHold(services, {
          profileId: scan.profileId,
          targetId: scan.targetId,
          targetName,
          taskId: scan.taskId,
          taskStatus,
        }),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  });
};
