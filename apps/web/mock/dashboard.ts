import {
  API_ROUTES,
  agentAssignment,
  type Dashboard,
  type DashboardEvent,
  RequestStatus,
  reviewAttention,
  type ScanHold,
  type ScanHoldGroup,
  type ScanHoldReason,
  tellEvents,
} from "@kickrocks/shared";

import { defineMockDomain, handle, notFound } from "./core.js";
import {
  buildMockNeedsYou,
  buildMockQueue,
  quietNow,
  scanHoldOf,
  scanReadiness,
} from "./review.js";

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

      const queue = buildMockQueue(store, profile.id);
      return {
        profileId: profile.id,
        total: requests.length,
        counts,
        attention: {
          ...reviewAttention(queue),
          ...agentAssignment(queue),
          needsYou: buildMockNeedsYou(store, profile.id).counts,
        },
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
