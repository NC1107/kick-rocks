import { z } from "zod";

/** Why a run stopped for a human. Each reason names something a person must do or decide. */
export const BlockedReason = z.enum([
  "captcha",
  "phone_verification",
  "id_upload",
  "email_verification",
  "login_required",
  "bot_detection",
  "approval_needed",
  "unknown",
]);
export type BlockedReason = z.infer<typeof BlockedReason>;

/**
 * How a removal form ended. A recipe can end a run with one of these without any step failing,
 * and a worker, an agent, or a person reports the same four.
 */
export const FormOutcome = z.enum([
  "submitted",
  "not_found",
  "already_removed",
  "awaiting_email_confirmation",
]);
export type FormOutcome = z.infer<typeof FormOutcome>;

/**
 * What broke when a task failed, so the server counts only the right ones against a recipe.
 * `recipe` means the recipe no longer matches the page (a missing selector, an expectation that
 * failed). `site` is the broker's own error or outage, `network` a connection that dropped, and
 * `internal` a bug on our side or an agent that gave up.
 */
export const FailureKind = z.enum(["recipe", "site", "network", "internal"]);
export type FailureKind = z.infer<typeof FailureKind>;
