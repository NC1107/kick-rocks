import { z } from "zod";

/** How much of a removal Kick Rocks can carry out on its own, from "just send it" to "needs a person or an agent". */
export const Difficulty = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof Difficulty>;

/**
 * Short machine-readable codes for why a target landed where it did; the UI turns them into words.
 * - `email`: it takes requests at a privacy address on its own domain.
 * - `no_record_needed`: a request can go out without finding a listing first.
 * - `form`: it takes requests through a web form.
 * - `recipe_ready`: an approved recipe exists for each step Kick Rocks runs, and none is broken.
 * - `needs_record`: a listing must be found before it can be removed.
 * - `needs_phone`, `needs_id`, `needs_payment`, `needs_account`, `captcha`, `needs_mail`,
 *   `needs_fax`: the site makes the person do this part.
 * - `no_recipe`: a form with no approved recipe, so an agent or the person has to fill it in.
 * - `recipe_broken`: the approved recipe is failing against the live site.
 * - `email_shared`: its only address is on a shared mail host such as gmail.com, which proves nothing about who replies.
 * - `no_contact`: no usable email address and no opt-out page.
 */
export const DifficultyReason = z.enum([
  "email",
  "no_record_needed",
  "form",
  "recipe_ready",
  "needs_record",
  "needs_phone",
  "needs_id",
  "needs_payment",
  "needs_account",
  "captcha",
  "needs_mail",
  "needs_fax",
  "no_recipe",
  "recipe_broken",
  "email_shared",
  "no_contact",
]);
export type DifficultyReason = z.infer<typeof DifficultyReason>;

export const DifficultyAssessment = z.object({
  difficulty: Difficulty,
  reasons: z.array(DifficultyReason),
});
export type DifficultyAssessment = z.infer<typeof DifficultyAssessment>;
