import { type KickRocksDb, mailboxes, profiles } from "@kickrocks/db";
import type { LegalApi } from "@kickrocks/legal";
import {
  type EmailKind,
  isOnDomain,
  type ProfileField,
  type RequestActor,
  type RequestChannel,
  type RequestEventDraft,
  type RequestEventPayloads,
  type RequestRecord,
  type RequestRight,
} from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import type { Clock } from "./clock.js";
import type { Dispatch } from "./dispatch.js";
import { conflict, notFound } from "./errors.js";
import type { RequestPatch, RequestsService } from "./requests.js";
import type { TargetsService } from "./targets.js";
import type { EnqueueResult } from "./task-queue.js";

interface OpenRequestInput {
  profileId: string;
  targetId: string;
  rights: RequestRight[];
  channel: RequestChannel;
  /** The record a form removal is for, which a person confirmed in a scan. */
  recordUrl?: string | null | undefined;
  campaignId?: string | null | undefined;
  actor: RequestActor;
}

interface OpenedRequest {
  /** The request, already in `queued`. */
  request: RequestRecord;
  dispatch: EnqueueResult;
}

interface RequeueInput {
  actor: RequestActor;
  /** Why it is going out again, which the timeline shows. */
  reason: RequestEventPayloads["queued"]["reason"];
  /** What the email is for, when the channel is email. */
  kind: EmailKind;
  /** Change the channel as it goes out again, such as a switch to the broker's web form. */
  channel?: RequestChannel | undefined;
  /** For a verification reply, the identifiers the person approved. */
  fields?: readonly ProfileField[] | undefined;
  /** For a verification reply, the Message-ID of the broker's message it answers. */
  inReplyTo?: string | null | undefined;
  patch?: RequestPatch | undefined;
  /** Events to write after the move, such as `channel_switched` or `user_action`. */
  events?: readonly RequestEventDraft[] | undefined;
}

/**
 * The two ways a request goes out, which campaigns, match decisions, relisting, resends,
 * verification replies, follow-ups, and channel switches all share. Each is one transaction, so a
 * request is never left half opened, queued with nothing to send it, or moved without its event.
 */
export interface RequestFlow {
  /**
   * Opens a request: resolves the legal basis for the profile's state and the target, picks the
   * profile's mailbox, creates the request, moves it from draft to queued, and dispatches it.
   * Throws, and leaves nothing behind, when it cannot be dispatched (no mailbox, no email address,
   * a record URL missing, a retired target).
   */
  open(input: OpenRequestInput): OpenedRequest;
  /** Moves a request that is out of its first send back to `queued` and dispatches it again. */
  requeue(requestId: string, input: RequeueInput): OpenedRequest;
}

export type Requests = RequestsService & RequestFlow;

interface RequestFlowDeps {
  db: KickRocksDb;
  clock: Clock;
  legal: LegalApi;
  requests: RequestsService;
  targets: TargetsService;
  dispatch: Dispatch;
}

export function createRequestFlow({
  db,
  clock,
  legal,
  requests,
  targets,
  dispatch,
}: RequestFlowDeps): RequestFlow {
  return {
    open(input) {
      return db.transaction(() => {
        const profile = db.select().from(profiles).where(eq(profiles.id, input.profileId)).get();
        if (!profile) throw notFound(`Profile ${input.profileId} not found`, "profile_not_found");
        const row = targets.getOrThrow(input.targetId);
        if (row.retired) {
          throw conflict(
            "target_retired",
            `${row.name} is no longer in the dataset, so nothing new can be sent to it`,
          );
        }
        if (input.recordUrl && !isOnDomain(input.recordUrl, row.domain)) {
          throw conflict(
            "record_url_off_domain",
            `The record is not on ${row.domain}, so no removal will be sent for it`,
          );
        }
        const mailbox = db
          .select({ id: mailboxes.id })
          .from(mailboxes)
          .where(eq(mailboxes.profileId, input.profileId))
          .get();
        const basis = legal.resolveLegalBasis({
          state: profile.state,
          target: targets.toSummary(row),
          rights: input.rights,
          asOf: clock.now(),
        });
        const created = requests.create({
          profileId: input.profileId,
          targetId: input.targetId,
          rights: input.rights,
          legalBasis: basis.id,
          channel: input.channel,
          campaignId: input.campaignId,
          mailboxId: mailbox?.id ?? null,
          recordUrl: input.recordUrl,
          actor: input.actor,
        });
        requests.transition(created.id, "queued", {
          actor: input.actor,
          event: { type: "queued", payload: { channel: input.channel, reason: "new" } },
        });
        const queued = dispatch.dispatchRequest(created.id, { kind: "initial" });
        return { request: requests.getOrThrow(created.id), dispatch: queued };
      });
    },

    requeue(requestId, input) {
      return db.transaction(() => {
        const channel = input.channel ?? requests.getOrThrow(requestId).channel;
        requests.transition(requestId, "queued", {
          actor: input.actor,
          event: { type: "queued", payload: { channel, reason: input.reason } },
          patch: { ...input.patch, ...(input.channel ? { channel: input.channel } : {}) },
        });
        for (const event of input.events ?? []) {
          requests.addEvent(requestId, { ...event, actor: input.actor });
        }
        const queued = dispatch.dispatchRequest(requestId, {
          kind: input.kind,
          fields: input.fields,
          inReplyTo: input.inReplyTo,
        });
        return { request: requests.getOrThrow(requestId), dispatch: queued };
      });
    },
  };
}
