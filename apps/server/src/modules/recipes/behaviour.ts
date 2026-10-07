import type { Recipe } from "@kickrocks/shared";

/**
 * What a recipe does, without its number or what its author says about having checked it. Two
 * recipes that agree on this run the same script, so what was learned about one holds for the
 * other and a repeated proposal is not a new one.
 */
export function behaviour(recipe: Recipe): string {
  return JSON.stringify({
    ...recipe,
    id: null,
    version: null,
    notes: null,
    verifiedAt: null,
    liveStatus: null,
  });
}
