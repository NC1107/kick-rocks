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
import type { AppServices } from "../../services.js";
import { buildReviewQueue } from "../review/queue.js";

const RECENT_EVENTS = 20;

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

  const recentEvents = db
    .select({
      id: requestEvents.id,
      requestId: requestEvents.requestId,
      type: requestEvents.type,
      actor: requestEvents.actor,
      payload: requestEvents.payload,
      createdAt: requestEvents.createdAt,
      requestReference: requests.reference,
      targetName: targets.name,
    })
    .from(requestEvents)
    .innerJoin(requests, eq(requests.id, requestEvents.requestId))
    .innerJoin(targets, eq(targets.id, requests.targetId))
    .where(eq(requests.profileId, profileId))
    .orderBy(desc(requestEvents.createdAt), desc(sql`${requestEvents}.rowid`))
    .limit(RECENT_EVENTS)
    .all()
    .map((row) => DashboardEvent.parse(row));

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
