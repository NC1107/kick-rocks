import { mailboxes, profiles, requestEvents, requests, scans, targets, tasks } from "@kickrocks/db";
import {
  API_ROUTES,
  agentAssignment,
  type Dashboard,
  DashboardEvent,
  RequestStatus,
  reviewAttention,
  type ScanHoldGroup,
  type ScanHoldReason,
  tellEvents,
} from "@kickrocks/shared";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { notFound } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import { buildListings, summarizeListings } from "../../core/listings.js";
import type { ModulePlugin } from "../../core/module.js";
import { profileScanReadiness, scanHold } from "../../core/scan-readiness.js";
import { withTrustedConfirmationSenders } from "../../core/targets.js";
import type { AppServices } from "../../services.js";
import { mailboxProblem } from "../mailbox/service.js";
import { buildReviewQueue } from "../review/queue.js";

// One newest told event per request, with the count of told events, so a noisy request cannot push
// the others out and the count agrees with the request's own timeline.
const RECENT_REQUESTS = 20;

/** The profile's queued scans, and what holds each back, so "nothing is happening" has a reason. */
function summarizeScans(services: AppServices, profileId: string): Dashboard["scans"] {
  const queued = services.db
    .select({
      profileId: scans.profileId,
      targetId: scans.targetId,
      targetName: targets.name,
      taskId: scans.taskId,
      taskStatus: tasks.status,
    })
    .from(scans)
    .innerJoin(targets, eq(scans.targetId, targets.id))
    .innerJoin(tasks, eq(scans.taskId, tasks.id))
    .where(and(eq(scans.profileId, profileId), eq(tasks.status, "queued")))
    .all();
  const byReason: Partial<Record<ScanHoldReason, ScanHoldGroup>> = {};
  let held = 0;
  for (const scan of queued) {
    const hold = scanHold(services, scan);
    if (!hold) continue;
    held += 1;
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
  return { queued: queued.length, held, byReason };
}

function buildDashboard(services: AppServices, profileId: string): Dashboard {
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

  const timeline = db
    .select({
      id: requestEvents.id,
      requestId: requestEvents.requestId,
      type: requestEvents.type,
      createdAt: requestEvents.createdAt,
    })
    .from(requestEvents)
    .innerJoin(requests, eq(requests.id, requestEvents.requestId))
    .where(eq(requests.profileId, profileId))
    .orderBy(requestEvents.createdAt, sql`${requestEvents}.rowid`)
    .all();

  const byRequest = new Map<string, typeof timeline>();
  for (const event of timeline) {
    const group = byRequest.get(event.requestId);
    if (group) group.push(event);
    else byRequest.set(event.requestId, [event]);
  }
  const recent = [...byRequest.values()]
    .flatMap((all) => {
      const told = tellEvents(all);
      const latest = told.at(-1);
      return latest ? [{ latest, eventCount: told.length }] : [];
    })
    .sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt))
    .slice(0, RECENT_REQUESTS);

  const rows = recent.length
    ? db
        .select({
          id: requestEvents.id,
          requestId: requestEvents.requestId,
          type: requestEvents.type,
          actor: requestEvents.actor,
          payload: requestEvents.payload,
          createdAt: requestEvents.createdAt,
          requestReference: requests.reference,
          targetName: targets.name,
          target: targets,
        })
        .from(requestEvents)
        .innerJoin(requests, eq(requests.id, requestEvents.requestId))
        .innerJoin(targets, eq(targets.id, requests.targetId))
        .where(
          inArray(
            requestEvents.id,
            recent.map(({ latest }) => latest.id),
          ),
        )
        .all()
    : [];
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const recentEvents = recent.flatMap(({ latest, eventCount }) => {
    const row = rowById.get(latest.id);
    if (!row) return [];
    const { target, ...event } = row;
    return [
      DashboardEvent.parse(
        withTrustedConfirmationSenders({ ...event, targetId: target.id, eventCount }, target),
      ),
    ];
  });

  return {
    profileId,
    total,
    counts,
    attention: { ...reviewAttention(queue), ...agentAssignment(queue) },
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
          lastError: mailboxProblem(mailbox),
        }
      : null,
    scans: summarizeScans(services, profileId),
    scanning: {
      ...profileScanReadiness(services, profileId),
      quiet: services.politeness.quietNow(),
    },
    listings: summarizeListings(buildListings(services, profileId)),
    recentEvents,
  };
}

export const dashboardModule: ModulePlugin = (app, services) => {
  registerRoute(app, API_ROUTES.dashboardGet, ({ params }) => buildDashboard(services, params.id));
};
