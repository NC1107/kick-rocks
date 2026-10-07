import { type KickRocksDb, requestEvents, requests } from "@kickrocks/db";
import {
  canTransition,
  generateReference,
  type Reference,
  type RequestActor,
  type RequestChannel,
  type RequestEvent,
  type RequestEventType,
  type RequestRecord,
  type RequestRight,
  type RequestStatus,
} from "@kickrocks/shared";
import { asc, eq, sql } from "drizzle-orm";
import { type Clock, nowIso } from "./clock.js";
import { conflict, notFound } from "./errors.js";
import { newId } from "./ids.js";
import { definedOnly } from "./objects.js";

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
  lastError?: string | null | undefined;
}

export interface TransitionOptions {
  actor: RequestActor;
  /** An extra event written next to `status_changed`, such as `channel_switched` or `sent`. */
  eventType?: RequestEventType | undefined;
  /** The payload of the extra event. */
  payload?: Record<string, unknown> | undefined;
  patch?: RequestPatch | undefined;
}

export interface AddEventInput {
  type: RequestEventType;
  actor: RequestActor;
  payload?: Record<string, unknown> | null | undefined;
}

/** Requests and their audit trail. Every status change goes through the state machine. */
export interface RequestsService {
  /** Creates a draft with a fresh KR- reference and a `created` event. */
  create(input: CreateRequestInput): RequestRecord;
  get(id: string): RequestRecord | null;
  getOrThrow(id: string): RequestRecord;
  getByReference(reference: string): RequestRecord | null;
  /** Writes `status_changed`, plus `options.eventType` when given, in one transaction. */
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
  /** Replaced in tests to force a collision. */
  generateReference?: () => Reference;
}

export function createRequestsService({
  db,
  clock,
  generateReference: makeReference = generateReference,
}: RequestsDeps): RequestsService {
  type Handle = Pick<KickRocksDb, "select" | "insert" | "update">;

  function insertEvent(handle: Handle, requestId: string, input: AddEventInput): RequestEvent {
    return handle
      .insert(requestEvents)
      .values({
        id: newId(),
        requestId,
        type: input.type,
        actor: input.actor,
        payload: input.payload ?? null,
        createdAt: nowIso(clock),
      })
      .returning()
      .get();
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

    transition(id, to, { actor, eventType, payload, patch }) {
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
          .set({ ...definedOnly(patch ?? {}), status: to, updatedAt: nowIso(clock) })
          .where(eq(requests.id, id))
          .returning()
          .get();
        insertEvent(tx, id, {
          type: "status_changed",
          actor,
          payload: { from: current.status, to },
        });
        if (eventType) insertEvent(tx, id, { type: eventType, actor, payload: payload ?? null });
        return row;
      });
    },

    update(id, patch) {
      return db.transaction((tx) => {
        load(tx, id);
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
        .all();
    },
  };
}
