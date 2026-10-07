import { z } from "zod";

export const TaskKind = z.enum([
  "email_send",
  "inbox_poll",
  "scan",
  "form",
  "confirm",
  "agent",
  "human_review",
]);
export type TaskKind = z.infer<typeof TaskKind>;

export const TaskStatus = z.enum(["queued", "leased", "done", "blocked", "failed", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const BlockedReason = z.enum([
  "captcha",
  "phone_verification",
  "id_upload",
  "email_verification",
  "login_required",
  "bot_detection",
  "recipe_failed",
  "unknown",
]);
export type BlockedReason = z.infer<typeof BlockedReason>;

/** The browser kinds, which any worker (built-in, MCP client, model-backed) may claim. */
export const BROWSER_TASK_KINDS: readonly TaskKind[] = ["scan", "form", "confirm", "agent"];

export const TaskLease = z.object({
  owner: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
export type TaskLease = z.infer<typeof TaskLease>;

export const TaskSummary = z.object({
  id: z.string(),
  kind: TaskKind,
  status: TaskStatus,
  priority: z.number().int(),
  targetName: z.string(),
  blockedReason: BlockedReason.nullable(),
  attempts: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type TaskSummary = z.infer<typeof TaskSummary>;
