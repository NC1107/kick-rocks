import {
  mailboxes,
  matches,
  messages,
  profiles,
  requestEvents,
  requests,
  targets,
  tasks,
} from "@kickrocks/db";
import {
  API_ROUTES,
  type Dashboard,
  DashboardEvent,
  isActiveStatus,
  RequestStatus,
} from "@kickrocks/shared";
import { and, count, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { notFound } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import type { AppServices } from "../../services.js";

const RECENT_EVENTS = 20;
const FAILED_TASK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const ACTIVE_STATUSES = RequestStatus.options.filter(isActiveStatus);

export function buildDashboard(services: AppServices, profileId: string): Dashboard {
  const { db, clock, mailQuota } = services;
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

  const blockedTasks =
    db
      .select({ n: count() })
      .from(tasks)
      .where(and(eq(tasks.profileId, profileId), eq(tasks.status, "blocked")))
      .get()?.n ?? 0;
  const pendingMatches =
    db
      .select({ n: count() })
      .from(matches)
      .where(and(eq(matches.profileId, profileId), eq(matches.decision, "pending")))
      .get()?.n ?? 0;
  const unreviewedMessages = mailbox
    ? (db
        .select({ n: count() })
        .from(messages)
        .where(and(eq(messages.mailboxId, mailbox.id), eq(messages.reviewed, false)))
        .get()?.n ?? 0)
    : 0;

  // A final failure on a request that is still open, or on work with no request such as a scan.
  const since = new Date(clock.now().getTime() - FAILED_TASK_WINDOW_MS).toISOString();
  const failedTasks =
    db
      .select({ n: count() })
      .from(tasks)
      .leftJoin(requests, eq(requests.id, tasks.requestId))
      .where(
        and(
          eq(tasks.profileId, profileId),
          eq(tasks.status, "failed"),
          gte(tasks.updatedAt, since),
          or(isNull(tasks.requestId), inArray(requests.status, ACTIVE_STATUSES)),
        ),
      )
      .get()?.n ?? 0;

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
    attention: {
      blockedTasks,
      pendingMatches,
      unreviewedMessages,
      needsVerification: counts.needs_verification,
      failedTasks,
    },
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
