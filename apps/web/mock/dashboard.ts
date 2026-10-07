import { API_ROUTES, type Dashboard, type DashboardEvent, RequestStatus } from "@kickrocks/shared";
import { defineMockDomain, handle, notFound } from "./core.js";

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
        .flatMap((request) =>
          request.events.map((event) => ({
            ...event,
            requestReference: request.reference,
            targetName: request.target.name,
          })),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 12);

      return {
        profileId: profile.id,
        total: requests.length,
        counts,
        attention: {
          blockedTasks: store.tasks.filter(
            (task) => task.profileId === profile.id && task.status === "blocked",
          ).length,
          pendingMatches: store.matches.filter(
            (match) => match.profileId === profile.id && match.decision === "pending",
          ).length,
          unreviewedMessages: store.messages.filter(
            (message) => !message.reviewed && message.mailboxId === profile.mailbox?.id,
          ).length,
          needsVerification: counts.needs_verification,
          failedTasks: store.tasks.filter(
            (task) =>
              task.profileId === profile.id &&
              task.status === "failed" &&
              task.updatedAt >= store.ago({ days: 30 }),
          ).length,
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
        recentEvents,
      };
    }),
  ],
});
