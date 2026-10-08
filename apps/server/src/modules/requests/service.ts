import { messages, profiles, requests as requestsTable, targets } from "@kickrocks/db";
import {
  availableActions,
  MessageSummary,
  type Paged,
  type ProfileField,
  type RequestAction,
  type RequestDetail,
  type RequestListItem,
  type RequestRecord,
  type RequestStatus,
  type RequestsQuery,
  resendEmailKind,
  resolveProfileFields,
  type VerificationReplyBody,
} from "@kickrocks/shared";
import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { nowIso } from "../../core/clock.js";
import { conflict, invalidRequest, notFound } from "../../core/errors.js";
import { loadIdentities } from "../../core/identities.js";
import { likePattern } from "../../core/like.js";
import { withTrustedConfirmationSenders } from "../../core/targets.js";
import type { AppServices } from "../../services.js";

const ACTION_OUTCOMES = {
  cancel: "cancelled",
  mark_confirmed: "confirmed",
  mark_rejected: "rejected",
  mark_no_record: "no_record",
} as const satisfies Partial<Record<RequestAction, RequestStatus>>;

interface RequestsApi {
  list(profileId: string, query: RequestsQuery): Paged<RequestListItem>;
  detail(id: string): RequestDetail;
  act(id: string, action: RequestAction): RequestDetail;
  replyToVerification(id: string, body: VerificationReplyBody): RequestDetail;
}

export function createRequestsApi(services: AppServices): RequestsApi {
  const { db, requests, targets: targetsService, taskQueue, dispatch } = services;

  function detail(id: string): RequestDetail {
    const record = requests.get(id);
    if (!record) throw notFound(`Request ${id} not found`, "request_not_found");
    const tasks = taskQueue.list({ requestId: id });
    const target = db.select().from(targets).where(eq(targets.id, record.targetId)).get();
    return {
      ...record,
      target: targetsService.summary(record.targetId),
      events: requests
        .events(id)
        .map((event) => (target ? withTrustedConfirmationSenders(event, target) : event)),
      messages: db
        .select()
        .from(messages)
        .where(eq(messages.requestId, id))
        .orderBy(asc(messages.receivedAt), asc(sql`rowid`))
        .all()
        .map((row) => MessageSummary.parse(row)),
      tasks: taskQueue.summarize(tasks),
      actions: availableActions(record, { hasLiveTask: taskQueue.hasLiveTask(id) }),
    };
  }

  function resend(record: RequestRecord): void {
    // A follow-up refers to a first request that went out, so one that never did goes out as new.
    const kind =
      resendEmailKind(record.status) === "follow_up" && record.sentAt !== null
        ? "follow_up"
        : "initial";
    const event = {
      type: "user_action",
      payload: { action: "resend", note: null },
    } as const;
    if (record.status === "queued") {
      // Already queued with nothing live to send it: the state machine has no queued -> queued move,
      // so the request is dispatched again where it stands.
      db.transaction(() => {
        requests.addEvent(record.id, { ...event, actor: "user" });
        dispatch.dispatchRequest(record.id, { kind: "initial" });
      });
      return;
    }
    requests.requeue(record.id, { actor: "user", reason: "resend", kind, events: [event] });
  }

  return {
    list(profileId, query) {
      const profileExists = db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, profileId))
        .get();
      if (!profileExists) throw notFound(`Profile ${profileId} not found`, "profile_not_found");

      const conditions: SQL[] = [eq(requestsTable.profileId, profileId)];
      if (query.status?.length) conditions.push(inArray(requestsTable.status, query.status));
      if (query.channel) conditions.push(eq(requestsTable.channel, query.channel));
      if (query.targetId) conditions.push(eq(requestsTable.targetId, query.targetId));
      if (query.q) {
        const pattern = likePattern(query.q);
        conditions.push(
          sql`(${targets.name} like ${pattern} escape '\\' or ${targets.domain} like ${pattern} escape '\\' or ${requestsTable.reference} like ${pattern} escape '\\')`,
        );
      }
      const where = and(...conditions);
      const total =
        db
          .select({ count: sql<number>`count(*)` })
          .from(requestsTable)
          .innerJoin(targets, eq(targets.id, requestsTable.targetId))
          .where(where)
          .get()?.count ?? 0;
      const rows = db
        .select({ request: requestsTable, target: targets })
        .from(requestsTable)
        .innerJoin(targets, eq(targets.id, requestsTable.targetId))
        .where(where)
        .orderBy(
          desc(requestsTable.updatedAt),
          desc(requestsTable.createdAt),
          asc(requestsTable.id),
        )
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)
        .all();
      return {
        items: rows.map(({ request, target }) => ({
          ...request,
          target: targetsService.toSummary(target),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    detail,

    act(id, action) {
      const record = requests.get(id);
      if (!record) throw notFound(`Request ${id} not found`, "request_not_found");
      const allowed = availableActions(record, { hasLiveTask: taskQueue.hasLiveTask(id) });
      if (!allowed.includes(action)) {
        throw conflict(
          "action_not_available",
          `A request that is ${record.status.replaceAll("_", " ")} cannot be ${phrase(action)}`,
        );
      }
      if (action === "resend") {
        resend(record);
      } else {
        requests.transition(id, ACTION_OUTCOMES[action], {
          actor: "user",
          event: { type: "user_action", payload: { action, note: null } },
        });
      }
      return detail(id);
    },

    replyToVerification(id, body) {
      const record = requests.get(id);
      if (!record) throw notFound(`Request ${id} not found`, "request_not_found");
      if (record.status !== "needs_verification") {
        throw conflict(
          "invalid_request_state",
          `Only a request waiting for verification can be answered, this one is ${record.status.replaceAll("_", " ")}`,
        );
      }
      const message = db.select().from(messages).where(eq(messages.id, body.messageId)).get();
      if (!message || message.requestId !== id) {
        throw notFound(
          `Message ${body.messageId} is not a message of this request`,
          "message_not_found",
        );
      }
      const asked = new Set<ProfileField>(message.requestedFields);
      const fields = [...new Set(body.fields)];
      const unasked = fields.filter((field) => !asked.has(field));
      if (unasked.length > 0) {
        throw invalidRequest(
          "Only identifiers the broker asked for can be sent",
          body.fields.flatMap((field, index) =>
            asked.has(field)
              ? []
              : [
                  {
                    path: ["body", "fields", index],
                    message: `The broker did not ask for ${field}`,
                  },
                ],
          ),
        );
      }
      const available = resolveProfileFields(loadIdentities(db, record.profileId), fields, {
        asOf: nowIso(services.clock).slice(0, 10),
      });
      const lacking = fields.filter((field) => available[field] === undefined);
      if (lacking.length > 0) {
        throw invalidRequest(
          "The profile has no value for a detail that was approved",
          lacking.map((field) => ({
            path: ["body", "fields", body.fields.indexOf(field)],
            message: `The profile has no ${field.replaceAll("_", " ")} to send`,
          })),
        );
      }
      db.transaction(() => {
        requests.requeue(id, {
          actor: "user",
          reason: "verification_reply",
          kind: "verification_reply",
          fields,
          inReplyTo: message.messageIdHeader,
          events: [{ type: "user_action", payload: { action: "verification_reply", note: null } }],
        });
        db.update(messages).set({ reviewed: true }).where(eq(messages.id, message.id)).run();
      });
      return detail(id);
    },
  };
}

function phrase(action: RequestAction): string {
  switch (action) {
    case "cancel":
      return "cancelled";
    case "resend":
      return "sent again";
    case "mark_confirmed":
      return "marked confirmed";
    case "mark_rejected":
      return "marked rejected";
    case "mark_no_record":
      return "marked as having no record";
  }
}
