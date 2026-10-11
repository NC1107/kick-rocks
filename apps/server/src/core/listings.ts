import { matches, type ScanRow, scans, targets, tasks } from "@kickrocks/db";
import {
  isActiveStatus,
  type ListingCounts,
  type ListingDetail,
  type ListingRecord,
  type ListingScan,
  type ListingSite,
  ListingStatus,
  type ListingsSummary,
  needsRecord,
  type RequestRecord,
  type ScanPreference,
} from "@kickrocks/shared";
import { desc, eq } from "drizzle-orm";
import { toMatch } from "../modules/review/mappers.js";
import { nextRescanAt } from "../scheduler/rescans.js";
import type { AppServices } from "../services.js";
import { isTerminalCancellation } from "./listing-scans.js";
import { preferenceBlocks } from "./scan-preferences.js";
import { describeMissingScanFields, missingScanFields, scanHold, scanRoute } from "./scan-readiness.js";
import { isPeopleSearchTarget } from "./targets.js";

type Row = ScanRow & { taskStatus: string | null };

const HISTORY_LIMIT = 10;

const isSettledRemoval = (request: RequestRecord) =>
  request.status === "confirmed" || request.status === "no_record";

/**
 * Where one site stands, from what is already stored. A choice the person made comes first, then
 * what needs their answer, then work in flight, then what the removals say, and last what the
 * newest finished scan found.
 */
export function deriveStatus(input: {
  preference: ScanPreference;
  today: string;
  scans: readonly Row[];
  records: readonly ListingRecord[];
  relisted: boolean;
}): ListingStatus {
  const { preference, today, records } = input;
  if (preference.mode === "skipped") return "skipped";
  if (records.some((record) => record.decision === "pending")) return "to_confirm";
  if (preferenceBlocks(preference, today) === "site_paused") return "paused";

  const latest = input.scans[0];
  if (latest && (latest.taskStatus === "queued" || latest.taskStatus === "blocked")) {
    return "waiting";
  }
  if (latest && latest.taskStatus === "leased") return "scanning";

  const mine = records.filter((record) => record.decision === "mine");
  if (mine.length > 0) {
    const requests = mine.flatMap((record) => (record.request ? [record.request] : []));
    const allSettled =
      requests.length > 0 &&
      requests.every((request) => request.status === "confirmed" || request.status === "no_record");
    if (allSettled) return "removed";
    return input.relisted ? "relisted" : "yours";
  }

  const finished = input.scans.find((scan) => scan.finishedAt !== null && !isTerminalCancellation(scan));
  if (!finished) return "not_scanned";
  if (finished.error !== null) return "failed";
  if (records.length > 0) return "not_you";
  return finished.noResultsShown ? "not_found" : "unclear";
}

function toListingScan(services: AppServices, scan: Row, targetName: string): ListingScan {
  return {
    id: scan.id,
    startedAt: scan.startedAt,
    finishedAt: scan.finishedAt,
    candidateCount: scan.candidates?.length ?? 0,
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
  scansByTarget: Map<string, Row[]>;
  matchesByTarget: Map<string, (typeof matches.$inferSelect)[]>;
}

function gather(services: AppServices, profileId: string): Gathered {
  const scanRows = services.db
    .select({ scan: scans, taskStatus: tasks.status })
    .from(scans)
    .leftJoin(tasks, eq(scans.taskId, tasks.id))
    .where(eq(scans.profileId, profileId))
    .orderBy(desc(scans.startedAt))
    .all();
  const scansByTarget = new Map<string, Row[]>();
  for (const { scan, taskStatus } of scanRows) {
    const list = scansByTarget.get(scan.targetId) ?? [];
    list.push({ ...scan, taskStatus });
    scansByTarget.set(scan.targetId, list);
  }
  const matchesByTarget = new Map<string, (typeof matches.$inferSelect)[]>();
  for (const row of services.db.select().from(matches).where(eq(matches.profileId, profileId)).all()) {
    const list = matchesByTarget.get(row.targetId) ?? [];
    list.push(row);
    matchesByTarget.set(row.targetId, list);
  }
  return { scansByTarget, matchesByTarget };
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
          ? { id: request.id, status: request.status, reference: request.reference }
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

  const status = deriveStatus({
    preference,
    today,
    scans: scanRows,
    records,
    relisted: relisted && stillActive,
  });

  const missing = missingScanFields(services, profileId, target.id);
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
  const lastStarted = scanRows.find((scan) => !isTerminalCancellation(scan))?.startedAt;
  const blocked = preferenceBlocks(preference, today);
  const rescanDays = preference.rescanDays ?? services.settings.get("schedule").peopleSearchRescanDays;
  const next =
    lastStarted && blocked === null
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
      (row) => (!row.retired && isPeopleSearchTarget(row)) || (scannedIds.has(row.id) && needsRecord(row)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildListings(services: AppServices, profileId: string): ListingSite[] {
  const gathered = gather(services, profileId);
  const preferences = services.scanPreferences.forProfile(profileId);
  const today = services.clock.now().toISOString().slice(0, 10);
  return listedTargets(services, new Set(gathered.scansByTarget.keys())).map(
    (target) =>
      buildSite(
        services,
        profileId,
        target,
        gathered,
        preferences.get(target.id) ?? services.scanPreferences.get(profileId, target.id),
        today,
      ).site,
  );
}

export function summarizeListings(sites: readonly ListingSite[]): ListingsSummary {
  const counts = Object.fromEntries(ListingStatus.options.map((status) => [status, 0])) as ListingCounts;
  let lastScanAt: string | null = null;
  let nextAt: string | null = null;
  for (const site of sites) {
    counts[site.status] = (counts[site.status] ?? 0) + 1;
    const started = site.latestScan?.startedAt;
    if (started && (lastScanAt === null || started > lastScanAt)) lastScanAt = started;
    if (site.nextRescanAt && (nextAt === null || site.nextRescanAt < nextAt)) {
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
  const gathered = gather(services, profileId);
  const { site, scans: scanRows } = buildSite(
    services,
    profileId,
    target,
    gathered,
    services.scanPreferences.get(profileId, targetId),
    services.clock.now().toISOString().slice(0, 10),
  );
  return {
    ...site,
    history: scanRows.slice(0, HISTORY_LIMIT).map((scan) => {
      const { noResultsShown: _drop, ...rest } = toListingScan(services, scan, target.name);
      return rest;
    }),
  };
}
