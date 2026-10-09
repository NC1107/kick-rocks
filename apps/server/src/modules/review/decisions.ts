import { mailboxes, matches, messages, requests, targets } from "@kickrocks/db";
import {
  isActiveStatus,
  type Match,
  type MatchDecisionBody,
  type MessageClassificationBody,
  type MessageSummary,
  normalizeRecordUrl,
} from "@kickrocks/shared";
import { and, eq } from "drizzle-orm";
import { conflict, notFound } from "../../core/errors.js";
import { applyReply, followConfirmationLinks } from "../../runners/reply.js";
import type { AppServices } from "../../services.js";
import { toMatch, toMessageSummary } from "./mappers.js";

/**
 * A request this match's record is already being removed by, so deciding "mine" twice (from a
 * scan and from a re-scan, say) never opens two removals for one page.
 */
function activeRemovalFor(services: AppServices, match: typeof matches.$inferSelect) {
  const key = normalizeRecordUrl(match.recordUrl);
  return services.db
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.profileId, match.profileId),
        eq(requests.targetId, match.targetId),
        eq(requests.channel, "form"),
      ),
    )
    .all()
    .find(
      (request) =>
        request.recordUrl !== null &&
        normalizeRecordUrl(request.recordUrl) === key &&
        isActiveStatus(request.status),
    );
}

/**
 * Records the person's answer about a record a scan found. "Mine" opens the removal for exactly
 * that record, in the same transaction, so a match is never marked mine without its request. A
 * decision can be repeated harmlessly, and "not mine" can be changed to "mine", but a removal that
 * was opened is cancelled from the request, not by taking the decision back.
 */
export function decideMatch(
  services: AppServices,
  matchId: string,
  body: MatchDecisionBody,
): Match {
  return services.db.transaction((tx) => {
    const match = tx.select().from(matches).where(eq(matches.id, matchId)).get();
    if (!match) throw notFound(`Match ${matchId} not found`, "match_not_found");
    const target = tx.select().from(targets).where(eq(targets.id, match.targetId)).get();
    const targetName = target?.name ?? match.targetId;

    if (match.decision === body.decision) return toMatch(match, targetName);
    if (match.decision === "mine") {
      throw conflict(
        "match_already_decided",
        "A removal was already opened for this record. Cancel the request instead.",
      );
    }

    let requestId: string | null = null;
    if (body.decision === "mine") {
      requestId =
        activeRemovalFor(services, match)?.id ??
        services.requests.open({
          profileId: match.profileId,
          targetId: match.targetId,
          rights: body.rights,
          channel: "form",
          recordUrl: match.recordUrl,
          actor: "user",
        }).request.id;
    }
    const decided = tx
      .update(matches)
      .set({
        decision: body.decision,
        decidedAt: services.clock.now().toISOString(),
        requestId,
      })
      .where(eq(matches.id, matchId))
      .returning()
      .get();
    return toMatch(decided, targetName);
  });
}

/**
 * A person's classification of a message the rules could not place. It is applied exactly like an
 * automatic one, with the person as the actor, and it may attach the message to a request. The
 * message is then reviewed, so it leaves the queue.
 */
export async function classifyByHand(
  services: AppServices,
  messageId: string,
  body: MessageClassificationBody,
): Promise<MessageSummary> {
  const row = services.db.select().from(messages).where(eq(messages.id, messageId)).get();
  if (!row) throw notFound(`Message ${messageId} not found`, "message_not_found");
  const mailbox = services.db.select().from(mailboxes).where(eq(mailboxes.id, row.mailboxId)).get();

  const requestId = body.requestId === undefined ? row.requestId : body.requestId;
  const request = requestId ? services.requests.get(requestId) : null;
  if (requestId && !request) throw notFound(`Request ${requestId} not found`, "request_not_found");
  if (request && mailbox && request.profileId !== mailbox.profileId) {
    throw conflict("request_mismatch", "That request belongs to another profile");
  }

  const link =
    request && body.classification === "confirmation_link"
      ? await followConfirmationLinks(services, request, row.links)
      : null;

  return services.db.transaction((tx) => {
    const updated = tx
      .update(messages)
      .set({
        classification: body.classification,
        confidence: 1,
        rationale: "Classified by hand",
        requestId,
        reviewed: true,
      })
      .where(eq(messages.id, messageId))
      .returning()
      .get();
    if (request) {
      const current = services.requests.getOrThrow(request.id);
      if (row.requestId !== request.id) {
        services.requests.addEvent(request.id, {
          type: "reply_received",
          actor: "user",
          payload: { messageId, from: row.fromAddress, subject: row.subject },
        });
      }
      applyReply(services, {
        request: current,
        messageId,
        classification: body.classification,
        confidence: 1,
        correlation: "manual",
        actor: "user",
        link,
        requestedFields: row.requestedFields,
        formLink: body.classification === "needs_form" ? (row.links[0] ?? null) : null,
      });
    }
    return toMessageSummary(updated);
  });
}
