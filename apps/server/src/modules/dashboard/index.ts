import { mailboxes, profiles, requestEvents, requests, targets } from "@kickrocks/db";
import {
  API_ROUTES,
  type Dashboard,
  DashboardEvent,
  RequestStatus,
  reviewAttention,
} from "@kickrocks/shared";
import { count, desc, eq, sql } from "drizzle-orm";
import { notFound } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import { withTrustedConfirmationSenders } from "../../core/targets.js";
import type { AppServices } from "../../services.js";
import { buildReviewQueue } from "../review/queue.js";

// One newest event per request, with the request's event count, so a noisy request cannot push
// the others out and there is no global row cap to make counts wrong.
const RECENT_REQUESTS = 20;

export function buildDashboard(services: AppServices, profileId: string): Dashboard {
  const { db, mailQuota } = services;
  const profile = db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .get();
  if (!profile) throw notFound(`Profile ${profileId} not found`, "profile_not_found");

  const counts = Object.fromEntries(RequestStatus.options.map((status) => [status, 0])) as Record<
    RequestStatus,
    number
  >;
  for (const row of db
    .select({ status: requests.status, n: count() })
    .from(requests)
    .where(eq(requests.profileId, profileId))
    .groupBy(requests.status)
    .all()) {
    counts[row.status] = row.n;
  }
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  const mailbox =
    db.select().from(mailboxes).where(eq(mailboxes.profileId, profileId)).get() ?? null;

  // The review page is where these totals lead, so they come from the same queue it lists.
  const queue = buildReviewQueue(services, profileId);

  const ranked = db
    .select({
      eventId: requestEvents.id,
      position:
        sql<number>`row_number() over (partition by ${requestEvents.requestId} order by ${requestEvents.createdAt} desc, ${requestEvents}.rowid desc)`.as(
          "position",
        ),
      eventCount: sql<number>`count(*) over (partition by ${requestEvents.requestId})`.as(
        "event_count",
      ),
    })
    .from(requestEvents)
    .innerJoin(requests, eq(requests.id, requestEvents.requestId))
    .where(eq(requests.profileId, profileId))
    .as("ranked");

  const recentEvents = db
    .select({
      id: requestEvents.id,
      requestId: requestEvents.requestId,
      type: requestEvents.type,
      actor: requestEvents.actor,
      payload: requestEvents.payload,
      createdAt: requestEvents.createdAt,
      eventCount: ranked.eventCount,
      requestReference: requests.reference,
      targetName: targets.name,
      target: targets,
    })
    .from(ranked)
    .innerJoin(requestEvents, eq(requestEvents.id, ranked.eventId))
    .innerJoin(requests, eq(requests.id, requestEvents.requestId))
    .innerJoin(targets, eq(targets.id, requests.targetId))
    .where(eq(ranked.position, 1))
    .orderBy(desc(requestEvents.createdAt), desc(sql`${requestEvents}.rowid`))
    .limit(RECENT_REQUESTS)
    .all()
    .map(({ target, ...row }) => DashboardEvent.parse(withTrustedConfirmationSenders(row, target)));

  return {
    profileId,
    total,
    counts,
    attention: reviewAttention(queue),
    sending: mailbox
      ? {
          sent: mailQuota.sentLastDay(mailbox.id),
          cap: mailbox.dailyCap,
          remaining: mailQuota.remaining(mailbox.id),
        }
      : null,
    mailbox: mailbox
      ? {
          address: mailbox.address,
          lastPolledAt: mailbox.lastPolledAt,
          lastError: mailbox.lastError,
        }
      : null,
    recentEvents,
  };
}

export const dashboardModule: ModulePlugin = (app, services) => {
  registerRoute(app, API_ROUTES.dashboardGet, ({ params }) => buildDashboard(services, params.id));
};
