import { z } from "zod";
import { ProfileField } from "./identities.js";
import { MessageSummary, Reference, ReplyClassification } from "./mail.js";
import { RequestListItem, RequestRights } from "./requests.js";
import { Match } from "./scans.js";
import { TaskSummary } from "./tasks.js";
import { WebUrl } from "./url.js";

export const BlockedTaskItem = z.object({
  task: TaskSummary,
  requestReference: Reference.nullable(),
  /** The page the person should open: where the worker got stuck, else the target's opt-out page. */
  url: WebUrl.nullable(),
  manualInstructions: z.string(),
});
export type BlockedTaskItem = z.infer<typeof BlockedTaskItem>;

export const ReviewMessage = MessageSummary.extend({
  requestReference: Reference.nullable(),
  targetName: z.string().nullable(),
});
export type ReviewMessage = z.infer<typeof ReviewMessage>;

/** A broker asked for more identifiers, and nothing goes out until the person approves some. */
export const VerificationItem = z.object({
  request: RequestListItem,
  /** The broker's message that asked. */
  message: MessageSummary,
  requestedFields: z.array(ProfileField),
});
export type VerificationItem = z.infer<typeof VerificationItem>;

/**
 * Everything waiting on a person: stuck tasks, records to confirm, brokers that asked for more
 * identifiers, tasks that failed for good, and mail nobody could classify.
 */
export const ReviewQueue = z.object({
  blockedTasks: z.array(BlockedTaskItem),
  matches: z.array(Match),
  verifications: z.array(VerificationItem),
  /**
   * Tasks that failed for good in the last 30 days whose request, if they have one, is still
   * open. A scan has no request, so a failed scan stays listed. Nothing retries them, so a person
   * has to, with `POST /tasks/:id/retry`.
   */
  failedTasks: z.array(BlockedTaskItem),
  /**
   * Agent tasks that no MCP client has claimed yet. Nothing else runs them, so a person can finish
   * one by hand, with `POST /tasks/:id/mark-done`, or drop it, with `POST /tasks/:id/cancel`.
   */
  agentTasks: z.array(BlockedTaskItem),
  messages: z.array(ReviewMessage),
});
export type ReviewQueue = z.infer<typeof ReviewQueue>;

/**
 * How many things of each kind wait on the person. The dashboard's "Needs you" card and the Review
 * badge both read these, so neither can say nothing is waiting while the queue lists something.
 */
export function reviewAttention(
  queue: Pick<
    ReviewQueue,
    "blockedTasks" | "matches" | "verifications" | "failedTasks" | "agentTasks" | "messages"
  >,
) {
  return {
    blockedTasks: queue.blockedTasks.length,
    pendingMatches: queue.matches.filter((match) => match.decision === "pending").length,
    needsVerification: queue.verifications.length,
    failedTasks: queue.failedTasks.length,
    agentTasks: queue.agentTasks.length,
    unreviewedMessages: queue.messages.length,
  };
}

export const MatchDecisionBody = z.object({
  decision: z.enum(["mine", "not_mine"]),
  /** The rights the removal request exercises when the decision is "mine". */
  rights: RequestRights.default(["opt_out", "delete"]),
});
export type MatchDecisionBody = z.infer<typeof MatchDecisionBody>;

export const MessageClassificationBody = z.object({
  classification: ReplyClassification,
  /** Attach the message to a request by hand when automatic correlation failed. */
  requestId: z.string().min(1).nullable().optional(),
});
export type MessageClassificationBody = z.infer<typeof MessageClassificationBody>;
