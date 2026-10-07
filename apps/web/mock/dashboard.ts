import {
  API_ROUTES,
  type Dashboard,
  type DashboardEvent,
  RequestStatus,
  reviewAttention,
} from "@kickrocks/shared";
import { defineMockDomain, handle, notFound } from "./core.js";
import { buildMockQueue } from "./review.js";

const DAY = 86_400_000;

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
          const told = request.events.filter(
            (event) =>
              event.type !== "status_changed" ||
              !request.events.some(
                (cause) =>
                  cause.type !== "status_changed" &&
                  Math.abs(Date.parse(cause.createdAt) - Date.parse(event.createdAt)) <= 60_000,
              ),
          );
          const latest = told.reduce<(typeof request.events)[number] | undefined>(
            (best, event) => (!best || event.createdAt > best.createdAt ? event : best),
            undefined,
          );
          return latest
            ? [
                {
                  ...latest,
                  eventCount: request.events.length,
                  requestReference: request.reference,
                  targetName: request.target.name,
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
        recentEvents,
      };
    }),
  ],
});
