import { matches, type ScanRow, scans, targets, tasks } from "@kickrocks/db";
import {
  DEFAULT_SCAN_PREFERENCE,
  deriveListingStatus,
  type Identity,
  isActiveStatus,
  type ListingCounts,
  type ListingDetail,
  type ListingRecord,
  type ListingScan,
  type ListingSite,
  ListingStatus,
  type ListingsSummary,
  needsRecord,
  preferenceBlocks,
  type RequestRecord,
  type ScanPreference,
} from "@kickrocks/shared";
import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { toMatch } from "../modules/review/mappers.js";
import { nextRescanAt } from "../scheduler/rescans.js";
import type { AppServices } from "../services.js";
import { loadIdentities } from "./identities.js";
import {
  describeMissingScanFields,
  missingScanFields,
  scanHold,
  scanRoute,
} from "./scan-readiness.js";
import { scanToday } from "./scan-today.js";
import { isPeopleSearchTarget } from "./targets.js";

type Row = Omit<ScanRow, "candidates"> & { candidateCount: number; taskStatus: string | null };

const HISTORY_LIMIT = 10;

/** Enough runs per site to find its newest finished scan and its history, however much it has run. */
const RECENT_SCANS_PER_SITE = 50;

function toListingScan(services: AppServices, scan: Row, targetName: string): ListingScan {
  return {
    id: scan.id,
    startedAt: scan.startedAt,
    finishedAt: scan.finishedAt,
    candidateCount: scan.candidateCount,
    noResultsShown: scan.noResultsShown === true,
    error: scan.error,
    taskStatus: scan.taskStatus as ListingScan["taskStatus"],
    hold: scanHold(services, {
      profileId: scan.profileId,
      targetId: scan.targetId,
      targetName,
      taskId: scan.taskId,
      taskStatus: scan.taskStatus,
    }),
  };
}

interface Gathered {
  identities: Identity[];
  scansByTarget: Map<string, Row[]>;
  matchesByTarget: Map<string, (typeof matches.$inferSelect)[]>;
}

const { candidates: _candidates, ...SCAN_COLUMNS } = getTableColumns(scans);

function gather(services: AppServices, profileId: string, targetId?: string): Gathered {
  const ofSite = targetId === undefined ? [] : [eq(scans.targetId, targetId)];
  const scanRows = services.db
    .select({
      ...SCAN_COLUMNS,
      candidateCount: sql<number>`coalesce(json_array_length(${scans.candidates}), 0)`,
      taskStatus: tasks.status,
    })
    .from(scans)
    .leftJoin(tasks, eq(scans.taskId, tasks.id))
    .where(
      and(
        eq(scans.profileId, profileId),
        ...ofSite,
        sql`(select count(*) from scans as newer where newer.profile_id = ${scans.profileId} and newer.target_id = ${scans.targetId} and newer.started_at > ${scans.startedAt}) < ${RECENT_SCANS_PER_SITE}`,
      ),
    )
    .orderBy(desc(scans.startedAt))
    .all();
  const scansByTarget = new Map<string, Row[]>();
  for (const scan of scanRows) {
    const list = scansByTarget.get(scan.targetId) ?? [];
    list.push(scan);
    scansByTarget.set(scan.targetId, list);
  }
  const matchesByTarget = new Map<string, (typeof matches.$inferSelect)[]>();
  for (const row of services.db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.profileId, profileId),
        ...(targetId === undefined ? [] : [eq(matches.targetId, targetId)]),
      ),
    )
    .all()) {
    const list = matchesByTarget.get(row.targetId) ?? [];
    list.push(row);
    matchesByTarget.set(row.targetId, list);
  }
  return {
    identities: loadIdentities(services.db, profileId),
    scansByTarget,
    matchesByTarget,
  };
}

const DECISION_ORDER = { pending: 0, mine: 1, not_mine: 2 } as const;

function buildSite(
  services: AppServices,
  profileId: string,
  target: typeof targets.$inferSelect,
  gathered: Gathered,
  preference: ScanPreference,
  today: string,
): { site: ListingSite; scans: Row[] } {
  const scanRows = gathered.scansByTarget.get(target.id) ?? [];
  const requestCache = new Map<string, RequestRecord | null>();
  const requestOf = (id: string | null): RequestRecord | null => {
    if (id === null) return null;
    if (!requestCache.has(id)) requestCache.set(id, services.requests.get(id));
    return requestCache.get(id) ?? null;
  };

  const records: ListingRecord[] = (gathered.matchesByTarget.get(target.id) ?? [])
    .map((row) => {
      const request = requestOf(row.requestId);
      return {
        ...toMatch(row, target.name),
        request: request
          ? {
              id: request.id,
              status: request.status,
              reference: request.reference,
              updatedAt: request.updatedAt,
            }
          : null,
      };
    })
    .sort(
      (a, b) =>
        DECISION_ORDER[a.decision] - DECISION_ORDER[b.decision] ||
        a.recordUrl.localeCompare(b.recordUrl),
    );

  const mineRequests = records.flatMap((record) =>
    record.decision === "mine" ? [requestOf(record.requestId)] : [],
  );
  const relisted = mineRequests.some(
    (request) =>
      request !== null &&
      services.requests.events(request.id).some((event) => event.type === "relisted"),
  );
  const stillActive = mineRequests.some((request) => request && isActiveStatus(request.status));

  const status = deriveListingStatus({
    preference,
    today,
    scans: scanRows.map((scan) => ({
      taskStatus: scan.taskStatus,
      finishedAt: scan.finishedAt,
      error: scan.error,
      noResultsShown: scan.noResultsShown === true,
    })),
    records,
    relisted: relisted && stillActive,
  });

  const missing = missingScanFields(services, profileId, target.id, gathered.identities);
  const readiness: ListingSite["readiness"] =
    missing.length > 0
      ? { state: "needs_details", missing: describeMissingScanFields(missing) }
      : (() => {
          const route = scanRoute(services, target.id);
          return {
            state: route === "recipe" ? "ready" : route === "agent" ? "no_recipe" : "recipe_review",
            missing: null,
          } as const;
        })();

  const newest = scanRows[0];
  const lastStarted = scanRows.find((scan) => scan.taskStatus !== "cancelled")?.startedAt;
  const blocked = preferenceBlocks(preference, today);
  const rescanDays =
    preference.rescanDays ?? services.settings.get("schedule").peopleSearchRescanDays;
  const next =
    lastStarted && blocked === null && preference.autoRescan && readiness.state !== "needs_details"
      ? nextRescanAt(
          profileId,
          services.politeness.domainOf(target.id) ?? target.id,
          lastStarted,
          rescanDays,
        )
      : null;

  return {
    scans: scanRows,
    site: {
      targetId: target.id,
      targetName: target.name,
      domain: target.domain,
      status,
      latestScan: newest ? toListingScan(services, newest, target.name) : null,
      records,
      readiness,
      preference,
      nextRescanAt: next,
    },
  };
}

/** The people-search sites a profile can be scanned on, plus any other site it has scans for. */
function listedTargets(services: AppServices, scannedIds: ReadonlySet<string>) {
  return services.db
    .select()
    .from(targets)
    .all()
    .filter(
      (row) =>
        (!row.retired && isPeopleSearchTarget(row)) || (scannedIds.has(row.id) && needsRecord(row)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildListings(services: AppServices, profileId: string): ListingSite[] {
  const gathered = gather(services, profileId);
  const preferences = services.scanPreferences.forProfile(profileId);
  const today = scanToday(services);
  return listedTargets(services, new Set(gathered.scansByTarget.keys())).map(
    (target) =>
      buildSite(
        services,
        profileId,
        target,
        gathered,
        preferences.get(target.id) ?? DEFAULT_SCAN_PREFERENCE,
        today,
      ).site,
  );
}

/** `nextRescanAt` is the soonest rescan still ahead; one already due is the scheduler's to run. */
export function summarizeListings(sites: readonly ListingSite[], now: Date): ListingsSummary {
  const counts = Object.fromEntries(
    ListingStatus.options.map((status) => [status, 0]),
  ) as ListingCounts;
  let lastScanAt: string | null = null;
  let nextAt: string | null = null;
  for (const site of sites) {
    counts[site.status] = (counts[site.status] ?? 0) + 1;
    const started = site.latestScan?.startedAt;
    if (started && (lastScanAt === null || started > lastScanAt)) lastScanAt = started;
    const upcoming = site.nextRescanAt !== null && Date.parse(site.nextRescanAt) > now.getTime();
    if (site.nextRescanAt && upcoming && (nextAt === null || site.nextRescanAt < nextAt)) {
      nextAt = site.nextRescanAt;
    }
  }
  return { counts, lastScanAt, nextRescanAt: nextAt };
}

export function buildListingDetail(
  services: AppServices,
  profileId: string,
  targetId: string,
): ListingDetail | null {
  const target = services.db.select().from(targets).where(eq(targets.id, targetId)).get();
  if (!target) return null;
  const gathered = gather(services, profileId, targetId);
  const { site, scans: scanRows } = buildSite(
    services,
    profileId,
    target,
    gathered,
    services.scanPreferences.get(profileId, targetId),
    scanToday(services),
  );
  return {
    ...site,
    history: scanRows.slice(0, HISTORY_LIMIT).map((scan) => {
      const { noResultsShown: _drop, ...rest } = toListingScan(services, scan, target.name);
      return rest;
    }),
  };
}
