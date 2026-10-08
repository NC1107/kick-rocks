import { mailboxes, type RequestRow, requests, type TargetRow, targets } from "@kickrocks/db";
import { canTransition } from "@kickrocks/shared";
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { AppError } from "../core/errors.js";
import type { AppServices } from "../services.js";

const DAY_MS = 24 * 60 * 60 * 1000;

interface OverdueSummary {
  noResponse: number;
  followUps: number;
  resends: number;
}

type Row = { request: RequestRow; target: TargetRow };

/**
 * What time does to a request nobody answered. A request past its due date becomes `no_response`.
 * Once the wait for a follow-up has also passed, an email request that has follow-ups left goes
 * out again as a follow-up, with the same threading as the first. Everything else that stays
 * unconfirmed is sent again from scratch every `brokerRescanDays`, which is how a broker that
 * ignores a form or two reminders is asked once more.
 */
export function advanceOverdueRequests(services: AppServices): OverdueSummary {
  const summary: OverdueSummary = { noResponse: 0, followUps: 0, resends: 0 };
  const attempt = guarded(services);

  for (const { request } of dueRows(services, ["awaiting_reply"], "dueAt")) {
    attempt(request, () => {
      if (!canTransition(request.status, "no_response", { actor: "system" })) return;
      services.requests.transition(request.id, "no_response", { actor: "system" });
      summary.noResponse += 1;
    });
  }

  const { maxFollowUps, brokerRescanDays } = services.settings.get("schedule");
  const resendAfterMs = brokerRescanDays * DAY_MS;
  const now = services.clock.now().getTime();

  for (const { request, target } of dueRows(
    services,
    ["no_response", "follow_up_due"],
    "followUp",
  )) {
    attempt(request, () => {
      if (canFollowUp(services, request, target, maxFollowUps)) {
        services.db.transaction(() => {
          if (request.status === "no_response") {
            services.requests.transition(request.id, "follow_up_due", { actor: "system" });
          }
          services.requests.requeue(request.id, {
            actor: "system",
            reason: "follow_up",
            kind: "follow_up",
          });
        });
        summary.followUps += 1;
        return;
      }
      const sentAt = request.sentAt ? Date.parse(request.sentAt) : null;
      if (target.kind !== "broker" || sentAt === null || sentAt + resendAfterMs > now) return;
      if (request.status !== "no_response") return;
      services.requests.requeue(request.id, {
        actor: "system",
        reason: "resend",
        kind: "initial",
      });
      summary.resends += 1;
    });
  }
  return summary;
}

/**
 * A follow-up is only worth queueing when it can actually go out, so the request is never moved
 * to `follow_up_due` and left there.
 */
function canFollowUp(
  services: AppServices,
  request: RequestRow,
  target: TargetRow,
  maxFollowUps: number,
): boolean {
  if (request.channel !== "email" || request.followUps >= maxFollowUps) return false;
  if (target.retired || !target.privacyEmail) return false;
  const mailbox = services.db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(eq(mailboxes.profileId, request.profileId))
    .get();
  return mailbox !== undefined;
}

function dueRows(
  services: AppServices,
  statuses: RequestRow["status"][],
  by: "dueAt" | "followUp",
): Row[] {
  const now = services.clock.now().toISOString();
  const moment =
    by === "dueAt"
      ? sql<string | null>`${requests.dueAt}`
      : sql<string | null>`coalesce(${requests.followUpAt}, ${requests.dueAt})`;
  return services.db
    .select({ request: requests, target: targets })
    .from(requests)
    .innerJoin(targets, eq(requests.targetId, targets.id))
    .where(and(inArray(requests.status, statuses), isNotNull(moment), lte(moment, now)))
    .orderBy(moment)
    .all();
}

/**
 * Runs one request's change and keeps going when it fails. A request that cannot be sent says why
 * on itself once, instead of every pass, so the person can see what needs fixing.
 */
function guarded(services: AppServices) {
  return (request: RequestRow, change: () => void): void => {
    try {
      change();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      services.logger.warn({ requestId: request.id, err: message }, "could not advance a request");
      if (error instanceof AppError && request.lastError !== message) {
        services.requests.update(request.id, { lastError: message });
      }
    }
  };
}
