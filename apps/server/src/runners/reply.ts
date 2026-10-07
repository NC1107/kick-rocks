import { requestEvents, targets } from "@kickrocks/db";
import {
  canTransition,
  isOnDomain,
  REPLY_OUTCOMES,
  type ReplyClassification,
  type RequestActor,
  type RequestRecord,
  WebUrl,
} from "@kickrocks/shared";
import { and, eq } from "drizzle-orm";
import { AppError } from "../core/errors.js";
import type { Task } from "../core/task-types.js";
import type { AppServices } from "../services.js";
import { describeError } from "./connection.js";

/** Below this the classifier is guessing, and a person should look before anything moves. */
export const CONFIDENCE_THRESHOLD = 0.6;

const MAX_LINKS_TRIED = 3;

/** What became of the confirmation links in a message, decided before the database is touched. */
export type LinkOutcome =
  | { kind: "followed"; url: string; finalUrl: string | null }
  | { kind: "browser"; url: string }
  | { kind: "failed"; url: string; finalUrl: string | null };

export interface AwaitingConfirmation {
  fromDomains: string[];
  linkTextPattern: string | null;
}

/** What the form run said the broker's confirmation email would look like, from the timeline. */
export function awaitingConfirmationOf(
  services: Pick<AppServices, "db">,
  requestId: string,
): AwaitingConfirmation {
  const rows = services.db
    .select()
    .from(requestEvents)
    .where(
      and(eq(requestEvents.requestId, requestId), eq(requestEvents.type, "awaiting_confirmation")),
    )
    .all();
  const latest = rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  const payload = latest?.payload as Partial<AwaitingConfirmation> | undefined;
  return {
    fromDomains: payload?.fromDomains ?? [],
    linkTextPattern: payload?.linkTextPattern ?? null,
  };
}

/**
 * Follows the first confirmation link that works, restricted to the target's own domain and the
 * senders the form said to expect. It talks to the network, so it runs before the transaction that
 * records the message and never inside one.
 */
export async function followConfirmationLinks(
  services: AppServices,
  request: RequestRecord,
  links: readonly string[],
): Promise<LinkOutcome | null> {
  if (request.status === "cancelled") return null;
  const usable = links.filter((link) => WebUrl.safeParse(link).success).slice(0, MAX_LINKS_TRIED);
  if (usable.length === 0) return null;
  const target = services.db.select().from(targets).where(eq(targets.id, request.targetId)).get();
  if (!target) return null;
  // A company's deletion confirmation can close an account, so a person decides whether to click it.
  if (target.kind === "company" && request.rights.includes("delete")) return null;
  const allowed = [target.domain, ...awaitingConfirmationOf(services, request.id).fromDomains];

  let failure: LinkOutcome = { kind: "failed", url: usable[0] as string, finalUrl: null };
  for (const url of usable) {
    try {
      const result = await services.mail.linkFollower.follow(url, allowed);
      if (result.ok && result.needsBrowser) return { kind: "browser", url };
      if (result.ok) {
        return { kind: "followed", url, finalUrl: validUrlOrNull(result.finalUrl) };
      }
      if (result.needsBrowser) return { kind: "browser", url };
      failure = { kind: "failed", url, finalUrl: validUrlOrNull(result.finalUrl) };
    } catch (error) {
      services.logger.warn(
        { requestId: request.id, err: describeError(error) },
        "following a confirmation link failed",
      );
      failure = { kind: "failed", url, finalUrl: null };
    }
  }
  return failure;
}

const validUrlOrNull = (url: string | null): string | null =>
  url !== null && WebUrl.safeParse(url).success ? url : null;

export interface AppliedReply {
  /** A person still needs to look at the message, because nothing could act on it. */
  needsReview: boolean;
}

export interface ApplyReplyInput {
  request: RequestRecord;
  messageId: string;
  classification: ReplyClassification;
  confidence: number;
  correlation: "message_id" | "reference" | "sender_domain" | "manual" | null;
  /** The classifier, or the person who classified it by hand. */
  actor: Extract<RequestActor, "system" | "user">;
  link: LinkOutcome | null;
  requestedFields: readonly string[];
}

/**
 * What a classified reply does to its request. It must run inside a transaction. A reply the
 * state machine will not apply is only recorded, because a late or early answer must never force
 * an illegal move and must never be lost.
 */
export function applyReply(services: AppServices, input: ApplyReplyInput): AppliedReply {
  const { requests } = services;
  const { request, classification, actor } = input;
  requests.addEvent(request.id, {
    type: "classified",
    actor,
    payload: {
      messageId: input.messageId,
      classification,
      confidence: input.confidence,
      correlation: input.correlation,
    },
  });

  switch (classification) {
    case "bounce":
    case "needs_form":
      return moveAndSwitch(services, input, classification);
    case "confirmation_link":
      return applyLink(services, input);
    case "auto_ack":
    case "unrelated":
      return { needsReview: false };
    case "unknown":
      return { needsReview: true };
    case "verification_required":
    case "completed":
    case "no_record":
    case "rejected": {
      const placed = moveTo(services, input);
      if (placed && classification === "verification_required") {
        cancelTasks(services, pendingSends(services, request.id), actor);
      }
      return {
        needsReview:
          !placed ||
          (classification === "verification_required" && input.requestedFields.length === 0),
      };
    }
  }
}

/**
 * Applies the status the classification stands for, when the state machine allows the move.
 * Says whether the request ends up in that status, so a reply that changed nothing can be shown to
 * a person instead of being filed as handled.
 */
function moveTo(
  services: AppServices,
  { request, actor, classification }: ApplyReplyInput,
): boolean {
  const to = REPLY_OUTCOMES[classification];
  if (!to) return true;
  const current = services.requests.getOrThrow(request.id);
  if (current.status === to) return true;
  if (!canTransition(current.status, to, { actor })) return false;
  services.requests.transition(request.id, to, { actor });
  return true;
}

/**
 * A follow-up or resend still waiting on the daily cap or the gap between sends has nothing left
 * to say once the broker bounced the mail or asked for details first. Only a send that has not
 * started is cancelled, because one already leased is on its way out.
 */
function pendingSends(services: AppServices, requestId: string): Task[] {
  return services.taskQueue.list({ kinds: ["email_send"], status: "queued", requestId });
}

function cancelTasks(
  services: AppServices,
  tasks: readonly Task[],
  actor: Extract<RequestActor, "system" | "user">,
): void {
  for (const task of tasks) services.taskQueue.cancel(task.id, actor);
}

/**
 * A bounce settles a request that is waiting on mail, including one whose follow-up or resend has
 * not gone out yet, which is cancelled because it would bounce the same way. A request that is
 * queued for anything else, such as a form run, is not waiting on that mail, so the bounce is only recorded.
 */
function applyBounce(services: AppServices, input: ApplyReplyInput): boolean {
  const { request, actor } = input;
  const current = services.requests.getOrThrow(request.id);
  const pending = pendingSends(services, request.id);
  if (current.status === "queued" && pending.length === 0) return false;
  const placed = moveTo(services, input);
  if (placed) cancelTasks(services, pending, actor);
  return placed;
}

/** A target with a form can be reached there when the mail channel is dead or was refused. */
function hasFormChannel(services: AppServices, targetId: string): boolean {
  const target = services.targets.getOrThrow(targetId);
  return (
    !target.retired &&
    (target.contactMethod === "form" || target.contactMethod === "both") &&
    target.optOutUrl !== null
  );
}

function moveAndSwitch(
  services: AppServices,
  input: ApplyReplyInput,
  reason: "bounce" | "needs_form",
): AppliedReply {
  const { request, actor } = input;
  const bounced = reason === "bounce" ? applyBounce(services, input) : true;

  const current = services.requests.getOrThrow(request.id);
  const canSwitch =
    current.channel === "email" &&
    hasFormChannel(services, current.targetId) &&
    canTransition(current.status, "queued", { actor });
  if (!canSwitch) {
    // A bounce with nowhere else to go is settled as bounced, unless the request could not be
    // moved there; a request for a form we cannot reach is never settled.
    return { needsReview: reason === "needs_form" || !bounced };
  }
  try {
    services.requests.requeue(request.id, {
      actor,
      reason: "channel_switch",
      kind: "initial",
      channel: "form",
      events: [
        {
          type: "channel_switched",
          payload: { from: "email", to: "form", reason },
        },
      ],
    });
    return { needsReview: false };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    services.logger.info(
      { requestId: request.id, reason: error.code },
      "could not switch the request to the form channel",
    );
    return { needsReview: true };
  }
}

function applyLink(services: AppServices, input: ApplyReplyInput): AppliedReply {
  const { request, link, actor } = input;
  if (!link) return { needsReview: true };
  if (link.kind === "browser") {
    // The browser task only opens the broker's own site, so a sister site's link would fail the
    // task for good with nobody told. A person gets the message instead.
    if (!isOnDomain(link.url, services.targets.getOrThrow(request.targetId).domain)) {
      return { needsReview: true };
    }
    services.dispatch.enqueueConfirm(request.id, link.url);
    return { needsReview: false };
  }
  services.requests.addEvent(request.id, {
    type: "link_followed",
    actor,
    payload: { url: link.url, finalUrl: link.finalUrl, ok: link.kind === "followed" },
  });
  if (link.kind === "followed") {
    // The confirmation the form was waiting for has been given, so it is no longer waiting.
    services.requests.update(request.id, { awaitingConfirmationSince: null });
    return { needsReview: false };
  }
  return { needsReview: true };
}
