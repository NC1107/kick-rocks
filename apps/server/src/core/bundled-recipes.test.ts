import { loadBrokerDataset } from "@kickrocks/brokers";
import { loadRecipes } from "@kickrocks/recipes";
import { describe, expect, it } from "vitest";
import { makeRecipe } from "../test-utils/builders.js";
import { type RecipeTarget, recipeTargetProblems } from "./recipe-catalog.js";

/**
 * Bundled recipes are written in parallel with the dataset, and a recipe's file name and brokerId
 * embed the broker id. This is the one place that fails when the two stop agreeing, instead of
 * the server skipping the recipe at startup.
 */
describe("bundled recipes", () => {
  const targets = new Map<string, RecipeTarget>(
    loadBrokerDataset().brokers.map((broker) => [broker.id, { domain: broker.domain }]),
  );
  const { recipes, errors } = loadRecipes({ extraDir: null });

  it("all load", () => {
    expect(errors).toEqual([]);
  });

  it("each name a live target in the generated dataset and stay on its domain", () => {
    const problems = recipes.flatMap(({ recipe }) => recipeTargetProblems(recipe, targets));
    expect(problems).toEqual([]);
  });
});

describe("recipeTargetProblems", () => {
  const targets = new Map<string, RecipeTarget>([
    ["spokeo", { domain: "spokeo.com" }],
    ["peopleconnect", { domain: "peopleconnect.us" }],
    ["intelius", { domain: "intelius.com" }],
  ]);

  function recipeOn(host: string, definition = {}) {
    return makeRecipe({
      brokerId: "spokeo",
      definition: {
        entryUrl: `https://${host}/optout`,
        canary: { url: `https://${host}/optout`, selectors: [{ label: "Email" }], steps: [] },
        steps: [
          { kind: "goto", url: `https://${host}/optout` },
          { kind: "click", target: { css: "button" } },
        ],
        ...definition,
      },
    });
  }

  it("accepts pages on the broker's domain and its subdomains", () => {
    expect(recipeTargetProblems(recipeOn("www.spokeo.com"), targets)).toEqual([]);
    expect(recipeTargetProblems(recipeOn("optout.spokeo.com"), targets)).toEqual([]);
  });

  it("names a broker that is not in the dataset", () => {
    const recipe = makeRecipe({ brokerId: "radaris" });
    expect(recipeTargetProblems(recipe, targets)).toEqual([
      'radaris.remove.v1: broker "radaris" is not a target in the dataset',
    ]);
  });

  it("names every page that is on some other site", () => {
    const recipe = recipeOn("www.spokeo.com", {
      steps: [
        { kind: "goto", url: "https://www.spokeo.com/optout" },
        { kind: "goto", url: "https://elsewhere.example/collect?e={{email}}" },
      ],
      fields: ["email"],
    });
    const problems = recipeTargetProblems(recipe, targets);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/steps\[1\].*elsewhere\.example.*not on spokeo\.com/);
    expect(
      recipeTargetProblems(recipeOn("elsewhere.example"), targets).map((p) => p.split(" (")[0]),
    ).toEqual([
      "spokeo.remove.v1: entryUrl",
      "spokeo.remove.v1: canary.url",
      "spokeo.remove.v1: steps[0]",
    ]);
  });

  it("lets a recipe also use the domain of a broker it serves, and names one that does not exist", () => {
    const suppression = makeRecipe({
      brokerId: "peopleconnect",
      definition: {
        alsoFor: ["intelius"],
        entryUrl: "https://suppression.peopleconnect.us/optout",
        canary: {
          url: "https://suppression.peopleconnect.us/optout",
          selectors: [{ css: "form" }],
          steps: [],
        },
        steps: [
          { kind: "goto", url: "https://suppression.peopleconnect.us/optout" },
          { kind: "goto", url: "https://www.intelius.com/optout" },
        ],
      },
    });
    expect(recipeTargetProblems(suppression, targets)).toEqual([]);
    const missing = { ...suppression, alsoFor: ["intelius", "ussearch"] };
    expect(recipeTargetProblems(missing, targets)).toEqual([
      'peopleconnect.remove.v1: alsoFor broker "ussearch" is not a target in the dataset',
    ]);
  });
});
