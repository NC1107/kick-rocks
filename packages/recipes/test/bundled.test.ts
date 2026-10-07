import { type ProfileField, type Recipe, renderTemplate } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { BUNDLED_RECIPES_DIR, loadRecipesFromDir } from "../src/index.js";

const { recipes, errors } = loadRecipesFromDir(BUNDLED_RECIPES_DIR, "bundled");

const SAMPLE: Record<ProfileField, string> = {
  first_name: "Jordan",
  last_name: "Example",
  full_name: "Jordan Example",
  email: "jordan@example.com",
  phone: "555-0100",
  city: "Saint Louis",
  state: "NY",
  zip: "10001",
  street: "1 Example Way",
  birth_year: "1980",
  date_of_birth: "1980-01-01",
  record_url: "https://www.example.com/record/1",
};

function recipeNamed(id: string): Recipe {
  const found = recipes.find((loaded) => loaded.recipe.id === id);
  if (!found) throw new Error(`No bundled recipe ${id}`);
  return found.recipe;
}

describe("the bundled recipes", () => {
  it("all load", () => {
    expect(errors).toEqual([]);
    expect(recipes.length).toBeGreaterThan(20);
  });

  it("keep one version of each broker and purpose, so a bump replaces the old file", () => {
    const keys = recipes.map(({ recipe }) => `${recipe.brokerId}.${recipe.purpose}`);
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
  });

  it("date every check and explain it in the notes", () => {
    for (const { recipe } of recipes) {
      expect(recipe.verifiedAt, recipe.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(recipe.notes, recipe.id).toBeTruthy();
    }
  });

  it("render every template in every goto, select and fill with the profile fields it declares", () => {
    for (const { recipe } of recipes) {
      const fields = Object.fromEntries(recipe.fields.map((field) => [field, SAMPLE[field]]));
      for (const step of recipe.steps) {
        const templates =
          step.kind === "goto"
            ? [step.url]
            : step.kind === "fill" || step.kind === "select"
              ? [step.value].filter((value): value is string => value !== undefined)
              : [];
        for (const template of templates) {
          if (template === "{{record_url}}") continue;
          expect(() => renderTemplate(template, fields), `${recipe.id}: ${template}`).not.toThrow();
        }
      }
    }
  });

  it("open every page over https", () => {
    for (const { recipe } of recipes) {
      const fields = Object.fromEntries(recipe.fields.map((field) => [field, SAMPLE[field]]));
      for (const step of recipe.steps) {
        if (step.kind !== "goto" || step.url === "{{record_url}}") continue;
        expect(new URL(renderTemplate(step.url, fields)).protocol, recipe.id).toBe("https:");
      }
    }
  });
});

describe("the Intelius scan", () => {
  const scan = recipeNamed("intelius.scan.v2");
  const goto = scan.steps[0];
  if (goto?.kind !== "goto") throw new Error("The first step of the Intelius scan is not a goto");

  it("opens the name page for the profile's state", () => {
    const url = (state: string) =>
      renderTemplate(goto.url, { first_name: "John", last_name: "Smith", state });
    expect(url("TX")).toBe("https://www.intelius.com/people-search/john-smith/texas/");
    expect(url("NY")).toBe("https://www.intelius.com/people-search/john-smith/new-york/");
    expect(url("nc")).toBe("https://www.intelius.com/people-search/john-smith/north-carolina/");
  });

  it("declares the state it needs", () => {
    expect(scan.fields).toContain("state");
  });
});
