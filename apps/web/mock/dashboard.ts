import {
  API_ROUTES,
  type Dashboard,
  type DashboardEvent,
  RequestStatus,
  reviewAttention,
  type ScanHold,
  type ScanHoldGroup,
  type ScanHoldReason,
  type ScanReadiness,
  tellEvents,
} from "@kickrocks/shared";

import { defineMockDomain, handle, notFound } from "./core.js";
import { buildMockQueue, quietNow, scanHoldOf } from "./review.js";
import type { MockStore } from "./store.js";

const DAY = 86_400_000;

function summarizeHeld(holds: readonly ScanHold[]): Partial<Record<ScanHoldReason, ScanHoldGroup>> {
  const byReason: Partial<Record<ScanHoldReason, ScanHoldGroup>> = {};
  for (const hold of holds) {
    const group = byReason[hold.reason];
    const until =
      hold.until !== undefined && (group?.until === undefined || hold.until < group.until)
        ? hold.until
        : group?.until;
    byReason[hold.reason] = {
      count: (group?.count ?? 0) + 1,
      ...(until !== undefined ? { until } : {}),
      ...(hold.serverClock ? { serverClock: true } : {}),
    };
  }
  return byReason;
}

/** Mirrors the server: what a profile can be scanned on now, from its address and each site's recipes. */
function scanReadiness(store: MockStore, profileId: string): ScanReadiness {
  const profile = store.profiles.find((candidate) => candidate.id === profileId);
  const hasPlace = profile?.identities.some(
    (identity) => identity.kind === "address" && Boolean(identity.value.city),
  );
  const sites = store.targets.filter((target) => target.needsRecord && !target.retired);
  if (!hasPlace) {
    return {
      ready: 0,
      noRecipe: 0,
      recipeNeedsReview: 0,
      needsDetails: sites.length,
      missing: "a current address with city and state",
    };
  }
  const counts = { ready: 0, noRecipe: 0, recipeNeedsReview: 0, needsDetails: 0 };
  for (const site of sites) {
    const scanRecipes = site.recipes.filter((recipe) => recipe.purpose === "scan");
    const usable = scanRecipes.some(
      (recipe) => recipe.status === "active" && recipe.health !== "broken",
    );
    if (usable) counts.ready += 1;
    else if (scanRecipes.some((recipe) => recipe.status === "pending_review")) {
      counts.recipeNeedsReview += 1;
    } else counts.noRecipe += 1;
  }
  return { ...counts, missing: null };
}

export default defineMockDomain({
  name: "dashboard",

  routes: (store) => [
    handle(API_ROUTES.dashboardGet, ({ params }): Dashboard => {
      const profile = store.profiles.find((candidate) => candidate.id === params.id);
      if (!profile) throw notFound("That profile");
      const requests = store.requests.filter((request) => request.profileId === profile.id);

      const counts = Object.fromEntries(
        RequestStatus.options.map((status) => [status, 0]),
      ) as Dashboard["counts"];
      for (const request of requests) counts[request.status] += 1;

      const since = store.clock.now().getTime() - DAY;
      const sent = profile.mailbox
        ? requests.filter(
            (request) =>
              request.channel === "email" && request.sentAt && Date.parse(request.sentAt) >= since,
          ).length
        : 0;

      const recentEvents: DashboardEvent[] = requests
        .flatMap((request) => {
          const told = tellEvents(request.events);
          const latest = told.reduce<(typeof request.events)[number] | undefined>(
            (best, event) => (!best || event.createdAt > best.createdAt ? event : best),
            undefined,
          );
          return latest
            ? [
                {
                  ...latest,
                  eventCount: told.length,
                  requestReference: request.reference,
                  targetName: request.target.name,
                  targetId: request.targetId,
                },
              ]
            : [];
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 20);

      return {
        profileId: profile.id,
        total: requests.length,
        counts,
        attention: reviewAttention(buildMockQueue(store, profile.id)),
        sending: profile.mailbox
          ? {
              sent,
              cap: profile.mailbox.dailyCap,
              remaining: Math.max(0, profile.mailbox.dailyCap - sent),
            }
          : null,
        mailbox: profile.mailbox
          ? {
              address: profile.mailbox.address,
              lastPolledAt: profile.mailbox.lastPolledAt,
              lastError: profile.mailbox.lastError,
            }
          : null,
        scans: (() => {
          const queued = store.scans.filter(
            (scan) => scan.profileId === profile.id && scan.taskStatus === "queued",
          );
          const holds = queued.flatMap((scan) => scanHoldOf(store, scan) ?? []);
          return { queued: queued.length, held: holds.length, byReason: summarizeHeld(holds) };
        })(),
        scanning: {
          ...scanReadiness(store, profile.id),
          quiet: quietNow(store),
        },
        recentEvents,
      };
    }),
  ],
});
