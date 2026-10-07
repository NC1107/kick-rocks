import { z } from "zod";
import { MessageSummary, Reference, ReplyClassification } from "./mail.js";
import { Match } from "./scans.js";
import { TaskSummary } from "./tasks.js";
import { WebUrl } from "./url.js";

export const BlockedTaskItem = z.object({
  task: TaskSummary,
  requestReference: Reference.nullable(),
  /** The page the person should open to finish the job by hand. */
  url: WebUrl.nullable(),
  manualInstructions: z.string(),
});
export type BlockedTaskItem = z.infer<typeof BlockedTaskItem>;

export const ReviewMessage = MessageSummary.extend({
  requestReference: Reference.nullable(),
  targetName: z.string().nullable(),
});
export type ReviewMessage = z.infer<typeof ReviewMessage>;

/** Everything waiting on a person: stuck tasks, records to confirm, and mail nobody could classify. */
export const ReviewQueue = z.object({
  blockedTasks: z.array(BlockedTaskItem),
  matches: z.array(Match),
  messages: z.array(ReviewMessage),
});
export type ReviewQueue = z.infer<typeof ReviewQueue>;

export const MatchDecisionBody = z.object({ decision: z.enum(["mine", "not_mine"]) });
export type MatchDecisionBody = z.infer<typeof MatchDecisionBody>;

export const MessageClassificationBody = z.object({
  classification: ReplyClassification,
  /** Attach the message to a request by hand when automatic correlation failed. */
  requestId: z.string().min(1).nullable().optional(),
});
export type MessageClassificationBody = z.infer<typeof MessageClassificationBody>;
