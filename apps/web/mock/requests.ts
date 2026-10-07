import {
  API_ROUTES,
  type BlockedReason,
  canTransition,
  generateReference,
  type MessageSummary,
  outgoingMessageId,
  type ReplyClassification,
  type RequestChannel,
  type RequestDetail,
  type RequestEvent,
  type RequestEventType,
  type RequestRight,
  type RequestStatus,
  type ReviewMessage,
  type TaskSummary,
} from "@kickrocks/shared";
import { conflict, defineMockDomain, handle, notFound } from "./core.js";
import type { MockStore, StoredRequest } from "./store.js";
import { summaryOf } from "./targets.js";

type Actor = RequestEvent["actor"];

export function addEvent(
  store: MockStore,
  request: StoredRequest,
  type: RequestEventType,
  actor: Actor,
  createdAt: string,
  payload: Record<string, unknown> | null = null,
): void {
  request.events.push({
    id: store.nextId("evt"),
    requestId: request.id,
    type,
    actor,
    payload,
    createdAt,
  });
}

export interface NewRequest {
  profileId: string;
  targetId: string;
  channel: RequestChannel;
  rights: RequestRight[];
  status: RequestStatus;
  /** Days ago the request was created. Everything else on the timeline is placed after it. */
  createdDaysAgo: number;
  campaignId?: string | null;
  followUps?: number;
  recordUrl?: string | null;
  lastError?: string | null;
}

const MS_DAY = 86_400_000;

/** Moves a time forward, but never past a minute ago: a fixture's history is all in the past. */
function shift(iso: string, days: number, hours = 0): string {
  const moved = Date.parse(iso) + days * MS_DAY + hours * 3_600_000;
  return new Date(Math.min(moved, Date.now() - 60_000)).toISOString();
}

const STATUSES_AFTER_SEND: ReadonlySet<RequestStatus> = new Set([
  "sent",
  "awaiting_reply",
  "confirmed",
  "rejected",
  "needs_verification",
  "no_record",
  "bounced",
  "no_response",
  "follow_up_due",
]);

const REPLY_FOR_STATUS: Partial<
  Record<RequestStatus, { classification: ReplyClassification; text: string }>
> = {
  confirmed: {
    classification: "completed",
    text: "We have removed your information from our systems and will not sell it.",
  },
  rejected: {
    classification: "rejected",
    text: "We are unable to process this request because we cannot verify that you are a resident.",
  },
  needs_verification: {
    classification: "verification_required",
    text: "To continue, please reply with a copy of a government ID and your date of birth.",
  },
  no_record: {
    classification: "no_record",
    text: "We searched our records and found no data matching the details you sent.",
  },
  bounced: {
    classification: "bounce",
    text: "Delivery to this address failed permanently: the mailbox does not exist.",
  },
};

function titleFor(status: RequestStatus): string {
  return status === "bounced" ? "Undeliverable: " : "Re: ";
}

/**
 * Builds one request with a believable timeline and, where the status implies one, a reply. It
 * pushes into the store and returns the stored request.
 */
export function buildRequest(store: MockStore, input: NewRequest): StoredRequest {
  const target = store.targets.find((candidate) => candidate.id === input.targetId);
  const profile = store.profiles.find((candidate) => candidate.id === input.profileId);
  if (!(target && profile)) throw new Error(`Cannot build a request for ${input.targetId}`);

  const id = store.nextId("req");
  const reference = generateReference((length) =>
    Uint8Array.from({ length }, () => Math.floor(store.random() * 256)),
  );
  // Offset by hours so a request "created today" still has its whole timeline in the past.
  const createdAt = store.ago({ days: input.createdDaysAgo, hours: 3 });
  const sent = STATUSES_AFTER_SEND.has(input.status);
  const sentAt = sent ? shift(createdAt, 0, 1) : null;
  const request: StoredRequest = {
    id,
    profileId: input.profileId,
    targetId: input.targetId,
    campaignId: input.campaignId ?? null,
    mailboxId: input.channel === "email" ? (profile.mailbox?.id ?? null) : null,
    rights: input.rights,
    legalBasis: profile.state === "CA" ? "ca-ccpa" : "policy",
    channel: input.channel,
    status: input.status,
    reference,
    outgoingMessageId:
      sent && input.channel === "email" ? outgoingMessageId(id, "example.com") : null,
    recordUrl: input.recordUrl ?? null,
    followUps: input.followUps ?? 0,
    sentAt,
    dueAt: sentAt ? shift(sentAt, 45) : null,
    followUpAt: input.status === "follow_up_due" ? shift(createdAt, 46) : null,
    lastError: input.lastError ?? null,
    createdAt,
    updatedAt: createdAt,
    target: summaryOf(target),
    events: [],
  };

  addEvent(store, request, "created", "system", createdAt, {
    rights: input.rights,
    channel: input.channel,
  });
  if (input.status === "draft") return finish(store, request);

  addEvent(store, request, "queued", "system", shift(createdAt, 0, 0.1));
  if (input.status === "queued") return finish(store, request);

  if (input.status === "cancelled") {
    const at = shift(createdAt, 0, 6);
    addEvent(store, request, "user_action", "user", at, { action: "cancel" });
    addEvent(store, request, "status_changed", "user", at, { from: "queued", to: "cancelled" });
    return finish(store, request);
  }

  const sendAt = sentAt as string;
  if (input.channel === "email") {
    addEvent(store, request, "sent", "system", sendAt, {
      to: target.privacyEmail,
      subject: `Opt-out request ${reference}`,
    });
  } else {
    addEvent(store, request, "task_enqueued", "system", sendAt, { kind: "form" });
    addEvent(store, request, "task_completed", "worker", shift(sendAt, 0, 0.2), {
      outcome: "submitted",
    });
  }
  if (input.status === "sent") return finish(store, request);

  addEvent(store, request, "status_changed", "system", shift(sendAt, 0, 0.01), {
    from: "sent",
    to: "awaiting_reply",
  });

  const reply = REPLY_FOR_STATUS[input.status];
  if (reply) {
    const replyDays = Math.min(
      3 + Math.floor(store.random() * 10),
      Math.max(1, input.createdDaysAgo - 1),
    );
    const receivedAt = shift(sendAt, replyDays);
    const message: ReviewMessage = {
      id: store.nextId("msg"),
      mailboxId: request.mailboxId ?? profile.mailbox?.id ?? "mbx_none",
      requestId: id,
      fromAddress:
        reply.classification === "bounce"
          ? "mailer-daemon@example.com"
          : `privacy@${target.domain}`,
      subject: `${titleFor(input.status)}Opt-out request ${reference}`,
      receivedAt,
      classification: reply.classification,
      confidence: 0.93,
      rationale: "Matched the reference in the subject and the reply wording.",
      links: [],
      snippet: reply.text,
      reviewed: true,
      requestReference: reference,
      targetName: target.name,
    };
    store.messages.push(message);
    addEvent(store, request, "reply_received", "system", receivedAt, {
      messageId: message.id,
      from: message.fromAddress,
    });
    addEvent(store, request, "classified", "system", shift(receivedAt, 0, 0.01), {
      classification: reply.classification,
      confidence: 0.93,
    });
    addEvent(store, request, "status_changed", "system", shift(receivedAt, 0, 0.02), {
      from: "awaiting_reply",
      to: input.status,
    });
  } else if (input.status === "no_response" || input.status === "follow_up_due") {
    addEvent(store, request, "status_changed", "system", shift(sendAt, 45), {
      from: "awaiting_reply",
      to: "no_response",
    });
    if (input.status === "follow_up_due") {
      addEvent(store, request, "status_changed", "system", shift(sendAt, 46), {
        from: "no_response",
        to: "follow_up_due",
      });
    }
  }
  return finish(store, request);
}

function finish(store: MockStore, request: StoredRequest): StoredRequest {
  const last = request.events.at(-1);
  request.updatedAt = last?.createdAt ?? request.createdAt;
  store.requests.push(request);
  return request;
}

export function makeTask(
  store: MockStore,
  fields: Pick<
    TaskSummary,
    "kind" | "status" | "profileId" | "targetId" | "targetName" | "requestId"
  > &
    Partial<
      Pick<
        TaskSummary,
        "blockedReason" | "blockedDetail" | "hasScreenshot" | "lastError" | "attempts"
      >
    >,
  updatedAgo: { days?: number; hours?: number; minutes?: number },
): TaskSummary {
  const task: TaskSummary = {
    id: store.nextId("tsk"),
    priority: 0,
    blockedReason: null,
    blockedDetail: null,
    attempts: 1,
    maxAttempts: 3,
    lastError: null,
    hasScreenshot: false,
    createdAt: store.ago({ ...updatedAgo, hours: (updatedAgo.hours ?? 0) + 1 }),
    updatedAt: store.ago(updatedAgo),
    ...fields,
  };
  store.tasks.push(task);
  return task;
}

interface Seed {
  target: string;
  status: RequestStatus;
  daysAgo: number;
  channel?: RequestChannel;
  rights?: RequestRight[];
  followUps?: number;
  recordUrl?: string;
  /** A form request whose task is parked for a person. */
  blocked?: { reason: BlockedReason; detail: string; screenshot?: boolean };
}

const BOTH: RequestRight[] = ["opt_out", "delete"];
const OPT_OUT: RequestRight[] = ["opt_out"];
const DELETE: RequestRight[] = ["delete"];

const JORDAN_REQUESTS: Seed[] = [
  { target: "audiencegrid", status: "confirmed", daysAgo: 62, rights: BOTH },
  { target: "lumen-data-partners", status: "confirmed", daysAgo: 58, rights: BOTH },
  { target: "alder-finch", status: "confirmed", daysAgo: 40, rights: OPT_OUT },
  { target: "corner-basket-market", status: "confirmed", daysAgo: 38, rights: OPT_OUT },
  { target: "brightlist", status: "confirmed", daysAgo: 33, rights: BOTH },
  {
    target: "peopletrace",
    status: "confirmed",
    daysAgo: 30,
    channel: "form",
    rights: DELETE,
    recordUrl: "https://www.peopletrace.example/person/jordan-example-ca-4821",
  },
  { target: "northgate-wireless", status: "confirmed", daysAgo: 29, rights: OPT_OUT },
  { target: "cardinal-insights", status: "awaiting_reply", daysAgo: 12, rights: BOTH },
  { target: "truesegment", status: "awaiting_reply", daysAgo: 11, rights: BOTH },
  { target: "summit-mutual", status: "awaiting_reply", daysAgo: 11, rights: OPT_OUT },
  { target: "daily-harbor-news", status: "awaiting_reply", daysAgo: 9, rights: OPT_OUT },
  { target: "waypoint-airlines", status: "awaiting_reply", daysAgo: 9, rights: BOTH },
  {
    target: "findrecord",
    status: "awaiting_reply",
    daysAgo: 8,
    channel: "form",
    rights: DELETE,
    recordUrl: "https://www.findrecord.example/p/jordan-q-example-9027",
    blocked: {
      reason: "captcha",
      detail: "A reCAPTCHA appeared before the removal form could be submitted.",
      screenshot: true,
    },
  },
  { target: "tidewater-card-services", status: "draft", daysAgo: 1, rights: BOTH },
  { target: "stayfield-hotels", status: "queued", daysAgo: 0, rights: OPT_OUT },
  { target: "pixelforge", status: "queued", daysAgo: 0, rights: OPT_OUT },
  { target: "harbor-consumer-data", status: "sent", daysAgo: 0, rights: BOTH },
  { target: "quillnote", status: "sent", daysAgo: 0, channel: "form", rights: OPT_OUT },
  {
    target: "clearcheck",
    status: "needs_verification",
    daysAgo: 21,
    channel: "form",
    rights: DELETE,
    recordUrl: "https://www.clearcheck.example/r/jordan-example-77310",
    blocked: {
      reason: "id_upload",
      detail: "The removal form asks for a photo of a government ID.",
      screenshot: true,
    },
  },
  {
    target: "homerecords",
    status: "needs_verification",
    daysAgo: 19,
    channel: "form",
    rights: DELETE,
    recordUrl: "https://www.homerecords.example/people/jordan-example-5530",
    blocked: {
      reason: "phone_verification",
      detail: "The site sends a text message code before it removes a record.",
    },
  },
  { target: "larkspur-bank", status: "rejected", daysAgo: 27, rights: OPT_OUT },
  { target: "recordvault", status: "rejected", daysAgo: 24, rights: DELETE },
  { target: "ashford-data-services", status: "no_record", daysAgo: 35, rights: BOTH },
  { target: "pinecrest-information", status: "no_record", daysAgo: 34, rights: BOTH },
  { target: "ledgerpoint", status: "bounced", daysAgo: 17, rights: BOTH },
  { target: "redwood-registered-data", status: "bounced", daysAgo: 16, rights: DELETE },
  { target: "openroster", status: "no_response", daysAgo: 52, rights: BOTH, followUps: 1 },
  { target: "greenhouse-outfitters", status: "no_response", daysAgo: 50, rights: OPT_OUT },
  { target: "cloudhaven", status: "no_response", daysAgo: 49, rights: BOTH },
  { target: "streamnest", status: "follow_up_due", daysAgo: 55, rights: OPT_OUT, followUps: 1 },
  { target: "juniper-home-goods", status: "follow_up_due", daysAgo: 54, rights: OPT_OUT },
  { target: "pawprint-pet-supply", status: "cancelled", daysAgo: 14, rights: OPT_OUT },
  { target: "driftwood-motors", status: "cancelled", daysAgo: 13, rights: OPT_OUT },
];

const RILEY_REQUESTS: Seed[] = [
  { target: "audiencegrid", status: "awaiting_reply", daysAgo: 6, rights: BOTH },
  { target: "sparrow-rewards", status: "confirmed", daysAgo: 20, rights: OPT_OUT },
  { target: "brightline-mobile", status: "sent", daysAgo: 1, channel: "form", rights: OPT_OUT },
];

function seedRequests(store: MockStore, profileIndex: number, seeds: Seed[]): void {
  const profile = store.profiles[profileIndex];
  if (!profile) return;
  for (const seed of seeds) {
    if (!store.targets.some((target) => target.id === seed.target)) continue;
    const request = buildRequest(store, {
      profileId: profile.id,
      targetId: seed.target,
      channel: seed.channel ?? "email",
      rights: seed.rights ?? OPT_OUT,
      status: seed.status,
      createdDaysAgo: seed.daysAgo,
      followUps: seed.followUps ?? 0,
      recordUrl: seed.recordUrl ?? null,
    });
    if (seed.channel === "form" && !seed.blocked) {
      makeTask(
        store,
        {
          kind: "form",
          status: seed.status === "sent" ? "queued" : "done",
          profileId: profile.id,
          targetId: request.targetId,
          targetName: request.target.name,
          requestId: request.id,
        },
        { days: seed.daysAgo },
      );
    }
    if (seed.blocked) {
      const task = makeTask(
        store,
        {
          kind: "form",
          status: "blocked",
          profileId: profile.id,
          targetId: request.targetId,
          targetName: request.target.name,
          requestId: request.id,
          blockedReason: seed.blocked.reason,
          blockedDetail: seed.blocked.detail,
          hasScreenshot: seed.blocked.screenshot ?? false,
        },
        { hours: 3 + Math.floor(store.random() * 40) },
      );
      addEvent(store, request, "task_blocked", "worker", task.updatedAt, {
        reason: seed.blocked.reason,
        detail: seed.blocked.detail,
      });
      request.updatedAt = task.updatedAt;
    }
  }
}

export function detailOf(store: MockStore, request: StoredRequest): RequestDetail {
  const { events, ...listItem } = request;
  const messages: MessageSummary[] = store.messages
    .filter((message) => message.requestId === request.id)
    .map(({ requestReference: _reference, targetName: _name, ...message }) => message);
  return {
    ...listItem,
    events: [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    messages,
    tasks: store.tasks.filter((task) => task.requestId === request.id),
  };
}

const ACTION_TARGET = {
  cancel: "cancelled",
  resend: "queued",
  mark_confirmed: "confirmed",
  mark_rejected: "rejected",
  mark_no_record: "no_record",
} as const satisfies Record<string, RequestStatus>;

export default defineMockDomain({
  name: "requests",

  seed(store) {
    // A target the dataset does not have is skipped, so a mismatch shows as a shorter list.
    seedRequests(store, 0, JORDAN_REQUESTS);
    seedRequests(store, 1, RILEY_REQUESTS);
  },

  routes: (store) => [
    handle(API_ROUTES.requestsList, ({ params, query }) => {
      const needle = query.q?.toLowerCase();
      const rows = store.requests
        .filter((request) => request.profileId === params.id)
        .filter((request) => (query.status ? query.status.includes(request.status) : true))
        .filter((request) => (query.channel ? request.channel === query.channel : true))
        .filter((request) => (query.targetId ? request.targetId === query.targetId : true))
        .filter((request) =>
          needle
            ? `${request.target.name} ${request.reference}`.toLowerCase().includes(needle)
            : true,
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const start = (query.page - 1) * query.pageSize;
      return {
        items: rows
          .slice(start, start + query.pageSize)
          .map(({ events: _events, ...item }) => item),
        total: rows.length,
        page: query.page,
        pageSize: query.pageSize,
      };
    }),

    handle(API_ROUTES.requestsGet, ({ params }) => {
      const request = store.requests.find((candidate) => candidate.id === params.id);
      if (!request) throw notFound("That request");
      return detailOf(store, request);
    }),

    handle(API_ROUTES.requestsAct, ({ params, body }) => {
      const request = store.requests.find((candidate) => candidate.id === params.id);
      if (!request) throw notFound("That request");
      const to: RequestStatus = ACTION_TARGET[body.action];
      if (!canTransition(request.status, to, { actor: "user" })) {
        throw conflict(`A ${request.status.replace("_", " ")} request cannot be changed that way.`);
      }
      const at = store.clock.now().toISOString();
      const from = request.status;
      addEvent(store, request, "user_action", "user", at, { action: body.action });
      if (body.action === "resend") {
        addEvent(store, request, "queued", "user", at);
        request.followUps += 1;
      }
      addEvent(store, request, "status_changed", "user", at, { from, to });
      request.status = to;
      request.updatedAt = at;
      return detailOf(store, request);
    }),
  ],
});
