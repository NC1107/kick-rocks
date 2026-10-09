import { requests as requestsTable } from "@kickrocks/db";
import type { RequestRecord, RequestStatus } from "@kickrocks/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { AppServices } from "../services.js";
import { AppError } from "./errors.js";
import { firstRecipient } from "./recipients.js";

type Services = Pick<
  AppServices,
  "db" | "dispatch" | "requests" | "taskQueue" | "targets" | "logger"
>;

/** Statuses where an email request is waiting on the broker or on the next send, with no person owed an answer. */
const REROUTABLE: readonly RequestStatus[] = [
  "queued",
  "awaiting_reply",
  "no_response",
  "follow_up_due",
];

/**
 * A dataset update can take a broker's email address away, for instance when a note shows the
 * address bounced. A request that was mailed keeps its recorded recipient and carries on, but one
 * with no recipient on record (never sent, or sent before recipients were recorded) has nowhere to
 * go: its send would fail, or its follow-ups would stop with nobody told. Those move to the broker's
 * form, the way a reply that asks for the form moves them, with the switch on the timeline.
 * A broker that has no form either keeps its requests, because there is no better route to give.
 */
export function moveRequestsToFormAfterEmailLoss(
  services: Services,
  targetIds: readonly string[],
): number {
  if (targetIds.length === 0) return 0;
  const { db, taskQueue, targets, logger } = services;
  const open = db
    .select()
    .from(requestsTable)
    .where(
      and(
        inArray(requestsTable.targetId, [...targetIds]),
        eq(requestsTable.channel, "email"),
        inArray(requestsTable.status, [...REROUTABLE]),
      ),
    )
    .all();
  let moved = 0;
  for (const request of open) {
    if (firstRecipient(db, request.id) !== null) continue;
    const target = targets.getOrThrow(request.targetId);
    const hasForm =
      !target.retired &&
      target.optOutUrl !== null &&
      (target.contactMethod === "form" || target.contactMethod === "both");
    if (!hasForm) continue;
    try {
      db.transaction(() => {
        const sends = taskQueue.list({ requestId: request.id, kinds: ["email_send"] });
        // A leased send is on its way out and settles itself, so the request is left to it.
        if (sends.some((task) => task.status === "leased")) return;
        for (const task of sends) if (task.status === "queued") taskQueue.cancel(task.id, "system");
        switchToForm(services, request);
        moved += 1;
      });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      logger.info(
        { requestId: request.id, reason: error.code },
        "could not move a request off an email address the dataset dropped",
      );
    }
  }
  return moved;
}

function switchToForm(services: Services, request: RequestRecord): void {
  const { requests, dispatch } = services;
  const switched = {
    type: "channel_switched" as const,
    payload: { from: "email" as const, to: "form" as const, reason: "needs_form" as const },
  };
  if (request.status !== "queued") {
    requests.requeue(request.id, {
      actor: "system",
      reason: "channel_switch",
      kind: "initial",
      channel: "form",
      events: [switched],
    });
    return;
  }
  // Already queued, so there is no status to move through: the channel changes in place.
  requests.update(request.id, { channel: "form" });
  requests.addEvent(request.id, {
    type: "queued",
    actor: "system",
    payload: { channel: "form", reason: "channel_switch" },
  });
  requests.addEvent(request.id, { ...switched, actor: "system" });
  dispatch.dispatchRequest(request.id, { kind: "initial" });
}
