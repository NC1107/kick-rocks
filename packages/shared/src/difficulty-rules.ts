import type { Requirement } from "./broker.js";
import type { DifficultyAssessment, DifficultyReason } from "./difficulty.js";
import { isSharedMailHost } from "./mail-hosts.js";
import type { RecipeHealth } from "./recipe.js";
import { needsRecord, type TargetCategory } from "./targets.js";

/** The health of a target's newest approved (active) recipe per purpose, or null when it has none. */
export interface ApprovedRecipes {
  scan: RecipeHealth | null;
  remove: RecipeHealth | null;
}

export interface DifficultyInput {
  id: string;
  category: TargetCategory;
  privacyEmail: string | null;
  optOutUrl: string | null;
  requiresId: boolean;
  requirements: readonly Requirement[];
  recipes: ApprovedRecipes;
}

/** Requirements that only the person can carry out, mapped to the reason shown for each. */
const PERSON_NEEDED: ReadonlyArray<readonly [Requirement, DifficultyReason]> = [
  ["phone_call", "needs_phone"],
  ["id_upload", "needs_id"],
  ["paid", "needs_payment"],
  ["account", "needs_account"],
  ["captcha", "captcha"],
  ["postal_mail", "needs_mail"],
  ["fax", "needs_fax"],
];

function personNeededReasons(input: DifficultyInput): DifficultyReason[] {
  const reasons = PERSON_NEEDED.filter(([requirement]) =>
    input.requirements.includes(requirement),
  ).map(([, reason]) => reason);
  // A site that wants ID is recorded in its category and flag, not always in its requirements.
  const asksForId = input.requiresId || input.category === "requires-id";
  if (asksForId && !reasons.includes("needs_id")) reasons.push("needs_id");
  return reasons;
}

function hasUsableEmail(email: string | null): boolean {
  const host = email?.split("@").pop()?.toLowerCase();
  return !!host && !isSharedMailHost(host);
}

function recipeStatus(health: RecipeHealth | null): "none" | "broken" | "ready" {
  if (health === null) return "none";
  return health === "broken" ? "broken" : "ready";
}

/**
 * Classifies a target from data Kick Rocks already holds. It is the one definition the server, the
 * mock, and the UI share, so a count on screen always matches what a campaign preset selects.
 *
 * - easy: a request goes out by email to a usable address, with no listing to find first and
 *   nothing only the person can do. Confirmation links are fine because Kick Rocks follows them.
 * - medium: a web form with a working approved remove recipe, or a people-search site with working
 *   approved scan and remove recipes, and nothing only the person can do.
 * - hard: everything else, above all anything a person must do, and any form without a working recipe.
 */
export function classifyDifficulty(input: DifficultyInput): DifficultyAssessment {
  const hard = (reasons: DifficultyReason[]): DifficultyAssessment => ({
    difficulty: "hard",
    reasons,
  });
  const person = personNeededReasons(input);
  const peopleSearch = needsRecord(input) || input.requirements.includes("record_url");

  if (peopleSearch) {
    const steps = [recipeStatus(input.recipes.scan), recipeStatus(input.recipes.remove)];
    const reasons: DifficultyReason[] = ["needs_record", ...person];
    if (steps.includes("none")) reasons.push("no_recipe");
    if (steps.includes("broken")) reasons.push("recipe_broken");
    if (person.length === 0 && steps.every((step) => step === "ready")) {
      return { difficulty: "medium", reasons: ["needs_record", "recipe_ready"] };
    }
    return hard(reasons);
  }

  if (person.length > 0) return hard(person);

  const emailUsable = hasUsableEmail(input.privacyEmail);
  if (emailUsable) return { difficulty: "easy", reasons: ["email", "no_record_needed"] };

  const reasons: DifficultyReason[] = input.privacyEmail === null ? [] : ["email_shared"];
  if (input.optOutUrl === null) return hard([...reasons, "no_contact"]);

  const remove = recipeStatus(input.recipes.remove);
  if (remove === "ready") {
    return { difficulty: "medium", reasons: [...reasons, "form", "recipe_ready"] };
  }
  return hard([...reasons, "form", remove === "broken" ? "recipe_broken" : "no_recipe"]);
}
