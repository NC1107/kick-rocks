import {
  API_ROUTES,
  DEFAULT_SCAN_PREFERENCE,
  deriveListingStatus,
  type ListingDetail,
  type ListingRecord,
  type ListingSite,
  ListingStatus,
  type ListingsSummary,
  preferenceBlocks,
  type ScanPreference,
  type ScanSummary,
} from "@kickrocks/shared";
import { defineMockDomain, handle, notFound } from "./core.js";
import { addEvent, buildRequest } from "./requests.js";
import { createScan, scanHoldOf, seedMockMatch } from "./review.js";
import type { MockStore } from "./store.js";

const DAY = 86_400_000;
const HISTORY_LIMIT = 10;

const keyOf = (profileId: string, targetId: string) => `${profileId}:${targetId}`;

export function preferenceOf(
  store: MockStore,
  profileId: string,
  targetId: string,
): ScanPreference {
  return store.scanPreferences.get(keyOf(profileId, targetId)) ?? DEFAULT_SCAN_PREFERENCE;
}

const todayOf = (store: MockStore) => store.clock.now().toISOString().slice(0, 10);

/** The same fixed slot inside the last quarter of the window the server derives from a hash. */
const SLOT = 0.4;

function recordsOf(store: MockStore, profileId: string, targetId: string): ListingRecord[] {
  const order = { pending: 0, mine: 1, not_mine: 2 } as const;
  return store.matches
    .filter((match) => match.profileId === profileId && match.targetId === targetId)
    .map((match) => {
      const request = match.requestId
        ? store.requests.find((candidate) => candidate.id === match.requestId)
        : undefined;
      return {
        ...match,
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
      (a, b) => order[a.decision] - order[b.decision] || a.recordUrl.localeCompare(b.recordUrl),
    );
}

function siteFor(
  store: MockStore,
  profileId: string,
  target: MockStore["targets"][number],
): { site: ListingSite; scans: ScanSummary[] } {
  const preference = preferenceOf(store, profileId, target.id);
  const scans = store.scans
    .filter((scan) => scan.profileId === profileId && scan.targetId === target.id)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const records = recordsOf(store, profileId, target.id);
  const mineRequests = records.flatMap((record) =>
    record.decision === "mine" && record.requestId
      ? store.requests.filter((request) => request.id === record.requestId)
      : [],
  );
  const relisted =
    mineRequests.some((request) => request.events.some((event) => event.type === "relisted")) &&
    mineRequests.some(
      (request) => !["confirmed", "no_record", "cancelled"].includes(request.status),
    );

  const status = deriveListingStatus({
    preference,
    today: todayOf(store),
    scans: scans.map((scan) => ({
      taskStatus: scan.taskStatus,
      finishedAt: scan.finishedAt,
      error: scan.error,
      noResultsShown: store.noResultsScans.has(scan.id),
    })),
    records,
    relisted,
  });

  const newest = scans[0];
  const lastStarted = scans.find((scan) => scan.taskStatus !== "cancelled")?.startedAt;
  const days = preference.rescanDays ?? store.settings.schedule.peopleSearchRescanDays;
  const next =
    lastStarted && preferenceBlocks(preference, todayOf(store)) === null && preference.autoRescan
      ? new Date(Date.parse(lastStarted) + days * DAY * (0.75 + 0.25 * SLOT)).toISOString()
      : null;

  const scanRecipes = target.recipes.filter((recipe) => recipe.purpose === "scan");
  const usable = scanRecipes.some(
    (recipe) => recipe.status === "active" && recipe.health !== "broken",
  );
  const state = usable
    ? "ready"
    : scanRecipes.some((recipe) => recipe.status === "pending_review")
      ? "recipe_review"
      : "no_recipe";

  return {
    scans,
    site: {
      targetId: target.id,
      targetName: target.name,
      domain: target.domain,
      status,
      latestScan: newest
        ? {
            id: newest.id,
            startedAt: newest.startedAt,
            finishedAt: newest.finishedAt,
            candidateCount: newest.candidateCount,
            noResultsShown: store.noResultsScans.has(newest.id),
            error: newest.error,
            taskStatus: newest.taskStatus,
            hold: scanHoldOf(store, newest),
          }
        : null,
      records,
      readiness: { state, missing: null },
      preference,
      nextRescanAt: next,
    },
  };
}

export function buildMockListings(store: MockStore, profileId: string): ListingSite[] {
  const profile = store.profiles.find((candidate) => candidate.id === profileId);
  const hasPlace = profile?.identities.some(
    (identity) => identity.kind === "address" && Boolean(identity.value.city),
  );
  return store.targets
    .filter((target) => target.needsRecord && !target.retired)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((target) => {
      const { site } = siteFor(store, profileId, target);
      if (!hasPlace && site.status === "not_scanned") {
        return {
          ...site,
          readiness: {
            state: "needs_details" as const,
            missing: "a current address with city and state",
          },
        };
      }
      return site;
    });
}

export function summarizeMockListings(sites: readonly ListingSite[], now: Date): ListingsSummary {
  const counts = Object.fromEntries(
    ListingStatus.options.map((status) => [status, 0]),
  ) as ListingsSummary["counts"];
  let lastScanAt: string | null = null;
  let nextRescanAt: string | null = null;
  for (const site of sites) {
    counts[site.status] += 1;
    const started = site.latestScan?.startedAt;
    if (started && (lastScanAt === null || started > lastScanAt)) lastScanAt = started;
    const upcoming = site.nextRescanAt !== null && Date.parse(site.nextRescanAt) > now.getTime();
    if (
      site.nextRescanAt &&
      upcoming &&
      (nextRescanAt === null || site.nextRescanAt < nextRescanAt)
    ) {
      nextRescanAt = site.nextRescanAt;
    }
  }
  return { counts, lastScanAt, nextRescanAt };
}

function detailOf(store: MockStore, profileId: string, targetId: string): ListingDetail {
  const target = store.targets.find((candidate) => candidate.id === targetId);
  if (!target) throw notFound("That target");
  const { site, scans } = siteFor(store, profileId, target);
  return {
    ...site,
    history: scans.slice(0, HISTORY_LIMIT).map((scan) => ({
      id: scan.id,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
      candidateCount: scan.candidateCount,
      error: scan.error,
      taskStatus: scan.taskStatus,
      hold: scanHoldOf(store, scan),
    })),
  };
}

/** Withdraws scans that have not started, the way pausing or skipping does on the server. */
function cancelWaiting(store: MockStore, profileId: string, targetId: string, reason: string) {
  for (const scan of store.scans) {
    if (scan.profileId !== profileId || scan.targetId !== targetId) continue;
    if (scan.taskStatus !== "queued" && scan.taskStatus !== "blocked") continue;
    scan.taskStatus = "cancelled";
    scan.finishedAt = store.clock.now().toISOString();
    scan.error = reason;
    const task = store.tasks.find((candidate) => candidate.id === scan.taskId);
    if (task) task.status = "cancelled";
  }
}

export default defineMockDomain({
  name: "listings",

  seed(store) {
    const jordan = store.profiles[0];
    if (!jordan) return;
    const finished = (targetId: string, startedAgo: { days?: number; hours?: number }) =>
      createScan(store, jordan.id, targetId, { finished: true, startedAgo });

    // Removed: a record that was found, claimed and confirmed gone.
    const trace = finished("peopletrace", { days: 35 });
    const traceRequest = store.requests.find(
      (request) => request.targetId === "peopletrace" && request.profileId === jordan.id,
    );
    if (trace && traceRequest) {
      seedMockMatch(
        store,
        trace,
        traceRequest.recordUrl ?? "https://www.peopletrace.example/person/jordan-example-ca-4821",
        { name: "Jordan Q Example", age: 35, locations: ["Sampleton, CA"] },
        "mine",
        traceRequest.id,
        store.ago({ days: 10 }),
      );
    }

    // Said removed: the site confirmed the removal, but no later scan has checked it yet.
    const locata = finished("locata", { days: 21 });
    const locataRequest = store.requests.find(
      (request) => request.targetId === "locata" && request.profileId === jordan.id,
    );
    if (locata && locataRequest) {
      seedMockMatch(
        store,
        locata,
        locataRequest.recordUrl ?? "",
        { name: "Jordan Example", age: 35, locations: ["Sampleton, CA"] },
        "mine",
        locataRequest.id,
      );
    }

    // Yours: a removal that was sent and is waiting on the site.
    const roster = finished("openroster", { days: 52 });
    const rosterRequest = store.requests.find(
      (request) => request.targetId === "openroster" && request.profileId === jordan.id,
    );
    if (roster && rosterRequest) {
      seedMockMatch(
        store,
        roster,
        "https://www.openroster.example/people/jordan-q-example",
        { name: "Jordan Q Example", age: 35, locations: ["Sampleton, CA"] },
        "mine",
        rosterRequest.id,
      );
    }

    // Relisted: the record came back after its removal was confirmed, so a new removal opened.
    const index = finished("addressbook-index", { days: 4 });
    if (index) {
      const first = buildRequest(store, {
        profileId: jordan.id,
        targetId: "addressbook-index",
        channel: "form",
        rights: ["opt_out", "delete"],
        status: "confirmed",
        createdDaysAgo: 100,
        recordUrl: "https://www.addressbookindex.example/p/jordan-example-4471",
      });
      const second = buildRequest(store, {
        profileId: jordan.id,
        targetId: "addressbook-index",
        channel: "form",
        rights: ["opt_out", "delete"],
        status: "awaiting_reply",
        createdDaysAgo: 4,
        recordUrl: "https://www.addressbookindex.example/p/jordan-example-4471",
      });
      addEvent(store, first, "relisted", "system", store.ago({ days: 4 }), {
        recordUrl: "https://www.addressbookindex.example/p/jordan-example-4471",
        previousStatus: "confirmed",
      });
      const fields = { name: "Jordan Example", age: 35, locations: ["Sampleton, CA"] };
      seedMockMatch(store, index, first.recordUrl ?? "", fields, "mine", first.id);
      seedMockMatch(store, index, `${first.recordUrl}?r=2`, fields, "mine", second.id);
    }

    // To confirm: a third site with two records, so the findings list spans several sites.
    const bay = finished("kinsearch", { hours: 18 });
    if (bay) {
      seedMockMatch(store, bay, "https://www.kinsearch.example/people/jordan-q-example-ca", {
        name: "Jordan Q Example",
        age: 36,
        locations: ["Sampleton, CA"],
        phones: ["(555) 555-0123"],
      });
      seedMockMatch(store, bay, "https://www.kinsearch.example/people/jordan-example-or", {
        name: "Jordan Example",
        age: 41,
        locations: ["Portland, OR"],
      });
    }

    // Not you: every candidate was turned down.
    const whereabout = finished("whereabout", { days: 20 });
    if (whereabout) {
      seedMockMatch(
        store,
        whereabout,
        "https://www.whereabout.example/p/jordan-example-tx",
        { name: "Jordan Example", age: 62, locations: ["Exampleburg, TX"] },
        "not_mine",
      );
    }

    // Not found: the site said it had nothing.
    const homeRecords = finished("homerecords", { days: 9 });
    if (homeRecords) store.noResultsScans.add(homeRecords.id);

    // Paused for a while, then skipped.
    finished("verifyfirst", { days: 45 });
    store.scanPreferences.set(keyOf(jordan.id, "verifyfirst"), {
      mode: "paused",
      pausedUntil: store.ahead({ days: 20 }).slice(0, 10),
      rescanDays: null,
      autoRescan: true,
      includePastAddresses: false,
    });
    store.scanPreferences.set(keyOf(jordan.id, "clearcheck"), {
      mode: "skipped",
      pausedUntil: null,
      rescanDays: 90,
      autoRescan: true,
      includePastAddresses: false,
    });
  },

  routes: (store) => [
    handle(API_ROUTES.listingsList, ({ params, query }) => {
      if (!store.profiles.some((profile) => profile.id === params.id)) {
        throw notFound("That profile");
      }
      const sites = buildMockListings(store, params.id);
      const wanted = query.status ? new Set(query.status) : null;
      const kept = wanted ? sites.filter((site) => wanted.has(site.status)) : sites;
      return {
        ...summarizeMockListings(sites, store.clock.now()),
        items: kept.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
        total: kept.length,
        page: query.page,
        pageSize: query.pageSize,
      };
    }),

    handle(API_ROUTES.listingsGet, ({ params }) => detailOf(store, params.id, params.targetId)),

    handle(API_ROUTES.listingsPreference, ({ params, body }) => {
      const current = preferenceOf(store, params.id, params.targetId);
      detailOf(store, params.id, params.targetId);
      const next: ScanPreference = {
        mode: body.mode,
        pausedUntil:
          body.mode !== "paused"
            ? null
            : body.pausedUntil !== undefined
              ? body.pausedUntil
              : current.mode === "paused"
                ? current.pausedUntil
                : null,
        rescanDays: body.rescanDays === undefined ? current.rescanDays : body.rescanDays,
        autoRescan: body.autoRescan ?? current.autoRescan,
        includePastAddresses: body.includePastAddresses ?? current.includePastAddresses,
      };
      store.scanPreferences.set(keyOf(params.id, params.targetId), next);
      if (next.mode === current.mode) return detailOf(store, params.id, params.targetId);
      if (next.mode === "paused") {
        cancelWaiting(store, params.id, params.targetId, "Cancelled because you paused this site");
      }
      if (next.mode === "skipped") {
        cancelWaiting(store, params.id, params.targetId, "Cancelled because you skipped this site");
      }
      return detailOf(store, params.id, params.targetId);
    }),
  ],
});
