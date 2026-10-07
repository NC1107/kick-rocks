import { type KickRocksDb, profiles, requestEvents, requests, targets } from "@kickrocks/db";
import {
  canTransition,
  generateReference,
  isTerminalStatus,
  parseEventPayload,
  type Reference,
  type RequestActor,
  type RequestChannel,
  RequestEvent,
  type RequestEventDraft,
  type RequestRecord,
  type RequestRight,
  type RequestStatus,
} from "@kickrocks/shared";
import { asc, eq, sql } from "drizzle-orm";
import { type Clock, nowIso } from "./clock.js";
import { conflict, notFound } from "./errors.js";
import { newId } from "./ids.js";
import { definedOnly } from "./objects.js";
import type { TaskQueue } from "./task-queue.js";

export interface CreateRequestInput {
  profileId: string;
  targetId: string;
  rights: RequestRight[];
  /** The id of the legal basis, such as a statute id or "policy". */
  legalBasis: string;
  channel: RequestChannel;
  campaignId?: string | null | undefined;
  mailboxId?: string | null | undefined;
  recordUrl?: string | null | undefined;
  actor?: RequestActor | undefined;
}

/** The columns that may change without a status change. */
export interface RequestPatch {
  channel?: RequestChannel | undefined;
  legalBasis?: string | undefined;
  mailboxId?: string | null | undefined;
  recordUrl?: string | null | undefined;
  outgoingMessageId?: string | null | undefined;
  followUps?: number | undefined;
  sentAt?: string | null | undefined;
  dueAt?: string | null | undefined;
  followUpAt?: string | null | undefined;
  /**
   * Marks a request as waiting for the broker's confirmation email. It is only meaningful in
   * `awaiting_reply`, so every status change clears it unless the same call sets it again.
   */
  awaitingConfirmationSince?: string | null | undefined;
  lastError?: string | null | undefined;
}

export interface TransitionOptions {
  actor: RequestActor;
  /** An extra event written next to `status_changed`, such as `channel_switched` or `sent`. */
  event?: RequestEventDraft | undefined;
  patch?: RequestPatch | undefined;
}

/** An event to write, its payload checked against what its type carries. */
export type AddEventInput = RequestEventDraft & { actor: RequestActor };

/**
 * Requests and their audit trail. Every status change goes through the state machine, and every
 * event payload is validated against `REQUEST_EVENT_PAYLOADS` before it is stored.
 */
export interface RequestsService {
  /**
   * Creates a draft with a fresh KR- reference and a `created` event. The profile and target must
   * exist and the target must not be retired.
   */
  create(input: CreateRequestInput): RequestRecord;
  get(id: string): RequestRecord | null;
  getOrThrow(id: string): RequestRecord;
  getByReference(reference: string): RequestRecord | null;
  /**
   * Writes `status_changed`, plus `options.event` when given, in one transaction. Moving to a
   * closed status (confirmed, no_record, cancelled, or rejected) cancels the request's live tasks
   * in the same transaction, so nothing keeps acting for a request that has been settled.
   */
  transition(id: string, to: RequestStatus, options: TransitionOptions): RequestRecord;
  /** Changes fields that are not the status. Does not write an event. */
  update(id: string, patch: RequestPatch): RequestRecord;
  addEvent(requestId: string, input: AddEventInput): RequestEvent;
  /** Oldest first. */
  events(requestId: string): RequestEvent[];
}

export interface RequestsDeps {
  db: KickRocksDb;
  clock: Clock;
  taskQueue: TaskQueue;
  /** Replaced in tests to force a collision. */
  generateReference?: () => Reference;
}

/** Whether a status ends the work: a person's answer is final, or the request is waiting to be appealed. */
const settles = (status: RequestStatus) => isTerminalStatus(status) || status === "rejected";

export function createRequestsService({
  db,
  clock,
  taskQueue,
  generateReference: makeReference = generateReference,
}: RequestsDeps): RequestsService {
  type Handle = Pick<KickRocksDb, "select" | "insert" | "update">;

  function insertEvent(handle: Handle, requestId: string, input: AddEventInput): RequestEvent {
    const payload = parseEventPayload(input.type, input.payload);
    const row = handle
      .insert(requestEvents)
      .values({
        id: newId(),
        requestId,
        type: input.type,
        actor: input.actor,
        payload,
        createdAt: nowIso(clock),
      })
      .returning()
      .get();
    return RequestEvent.parse(row);
  }

  function load(handle: Handle, id: string): RequestRecord {
    const row = handle.select().from(requests).where(eq(requests.id, id)).get();
    if (!row) throw notFound(`Request ${id} not found`, "request_not_found");
    return row;
  }

  function freshReference(handle: Handle): Reference {
    for (let attempt = 0; attempt < 20; attempt++) {
      const reference = makeReference();
      const taken = handle
        .select({ one: sql<number>`1` })
        .from(requests)
        .where(eq(requests.reference, reference))
        .get();
      if (!taken) return reference;
    }
    throw new Error("Could not find an unused request reference");
  }

  return {
    create(input) {
      const now = nowIso(clock);
      return db.transaction((tx) => {
        const profile = tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.id, input.profileId))
          .get();
        if (!profile) throw notFound(`Profile ${input.profileId} not found`, "profile_not_found");
        const target = tx.select().from(targets).where(eq(targets.id, input.targetId)).get();
        if (!target) throw notFound(`Target ${input.targetId} not found`, "target_not_found");
        if (target.retired) {
          throw conflict(
            "target_retired",
            `${target.name} is no longer in the dataset, so nothing new can be sent to it`,
          );
        }
        const row = tx
          .insert(requests)
          .values({
            id: newId(),
            profileId: input.profileId,
            targetId: input.targetId,
            campaignId: input.campaignId ?? null,
            mailboxId: input.mailboxId ?? null,
            rights: input.rights,
            legalBasis: input.legalBasis,
            channel: input.channel,
            status: "draft",
            reference: freshReference(tx),
            recordUrl: input.recordUrl ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        insertEvent(tx, row.id, {
          type: "created",
          actor: input.actor ?? "system",
          payload: { channel: row.channel, rights: row.rights, reference: row.reference },
        });
        return row;
      });
    },

    get(id) {
      return db.select().from(requests).where(eq(requests.id, id)).get() ?? null;
    },

    getOrThrow(id) {
      return load(db, id);
    },

    getByReference(reference) {
      return db.select().from(requests).where(eq(requests.reference, reference)).get() ?? null;
    },

    transition(id, to, { actor, event, patch }) {
      return db.transaction((tx) => {
        const current = load(tx, id);
        if (!canTransition(current.status, to, { actor })) {
          throw conflict(
            "invalid_transition",
            `A request cannot move from ${current.status} to ${to}`,
          );
        }
        const row = tx
          .update(requests)
          .set({
            ...definedOnly(patch ?? {}),
            awaitingConfirmationSince: patch?.awaitingConfirmationSince ?? null,
            status: to,
            updatedAt: nowIso(clock),
          })
          .where(eq(requests.id, id))
          .returning()
          .get();
        insertEvent(tx, id, {
          type: "status_changed",
          actor,
          payload: { from: current.status, to },
        });
        if (event) insertEvent(tx, id, { ...event, actor });
        if (settles(to)) taskQueue.cancelForRequest(id, actor);
        return row;
      });
    },

    update(id, patch) {
      return db.transaction((tx) => {
        const current = load(tx, id);
        if (patch.awaitingConfirmationSince && current.status !== "awaiting_reply") {
          throw conflict(
            "invalid_request_state",
            `Only a request that is awaiting a reply can wait for a confirmation email, this one is ${current.status}`,
          );
        }
        return tx
          .update(requests)
          .set({ ...definedOnly(patch), updatedAt: nowIso(clock) })
          .where(eq(requests.id, id))
          .returning()
          .get();
      });
    },

    addEvent(requestId, input) {
      return db.transaction((tx) => {
        load(tx, requestId);
        return insertEvent(tx, requestId, input);
      });
    },

    events(requestId) {
      return db
        .select()
        .from(requestEvents)
        .where(eq(requestEvents.requestId, requestId))
        .orderBy(asc(requestEvents.createdAt), asc(sql`rowid`))
        .all()
        .map((row) => RequestEvent.parse(row));
    },
  };
}
