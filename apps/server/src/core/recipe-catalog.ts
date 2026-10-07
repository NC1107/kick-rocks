import { isOnDomain, type Recipe } from "@kickrocks/shared";

/** The part of a target a recipe is checked against. */
export interface RecipeTarget {
  domain: string;
}

function webUrlsOf(recipe: Recipe): { where: string; url: string }[] {
  const urls = [
    { where: "entryUrl", url: recipe.entryUrl },
    { where: "canary.url", url: recipe.canary.url },
  ];
  recipe.steps.forEach((step, index) => {
    if (step.kind === "goto" && /^https?:\/\//.test(step.url)) {
      urls.push({ where: `steps[${index}]`, url: step.url });
    }
  });
  recipe.canary.steps.forEach((step, index) => {
    if (step.kind === "goto") urls.push({ where: `canary.steps[${index}]`, url: step.url });
  });
  return urls;
}

/**
 * What is wrong with a recipe once it is put next to the targets it names. A recipe is a script
 * that runs in the person's own browser with their details, so a broker id that does not exist
 * (and would be skipped without a word) or a page on some other site is reported, not tolerated.
 * Pages must be on the broker's domain or on a broker the recipe also serves.
 */
export function recipeTargetProblems(
  recipe: Recipe,
  targetsById: ReadonlyMap<string, RecipeTarget>,
): string[] {
  const problems: string[] = [];
  const own = targetsById.get(recipe.brokerId);
  if (!own) {
    return [`${recipe.id}: broker "${recipe.brokerId}" is not a target in the dataset`];
  }
  const domains = [own.domain];
  for (const other of recipe.alsoFor) {
    const target = targetsById.get(other);
    if (target) domains.push(target.domain);
    else problems.push(`${recipe.id}: alsoFor broker "${other}" is not a target in the dataset`);
  }
  for (const { where, url } of webUrlsOf(recipe)) {
    if (!domains.some((domain) => isOnDomain(url, domain))) {
      problems.push(`${recipe.id}: ${where} (${url}) is not on ${domains.join(" or ")}`);
    }
  }
  return problems;
}
