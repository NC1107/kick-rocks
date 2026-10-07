import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUNDLED_RECIPES_DIR, loadRecipes, loadRecipesFromDir } from "./loader.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kickrocks-recipes-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function scanRecipe(brokerId: string, version = 1, notes: string | null = null) {
  return {
    id: `${brokerId}.scan.v${version}`,
    brokerId,
    version,
    purpose: "scan",
    entryUrl: `https://${brokerId}.test/search`,
    fields: ["first_name", "last_name"],
    steps: [
      { kind: "goto", url: `https://${brokerId}.test/{{first_name|slug}}-{{last_name|slug}}` },
      {
        kind: "extract_candidates",
        item: { css: ".card" },
        fields: { recordUrl: { css: "a", attr: "href" }, name: { css: "h2" } },
      },
    ],
    canary: { url: `https://${brokerId}.test/search`, selectors: [{ css: "form" }] },
    notes,
  };
}

function writeRecipe(dir: string, recipe: { id: string }, fileName = `${recipe.id}.json`) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), JSON.stringify(recipe));
}

describe("loadRecipesFromDir", () => {
  it("loads valid recipes in file name order", () => {
    writeRecipe(root, scanRecipe("zeta"));
    writeRecipe(root, scanRecipe("alpha"));
    const { recipes, errors } = loadRecipesFromDir(root, "bundled");
    expect(errors).toEqual([]);
    expect(recipes.map((r) => r.recipe.id)).toEqual(["alpha.scan.v1", "zeta.scan.v1"]);
    expect(recipes[0]).toMatchObject({ origin: "bundled", file: join(root, "alpha.scan.v1.json") });
  });

  it("applies schema defaults", () => {
    writeRecipe(root, scanRecipe("alpha"));
    const [loaded] = loadRecipesFromDir(root, "bundled").recipes;
    expect(loaded?.recipe).toMatchObject({ verifiedAt: null, liveStatus: "unverified" });
  });

  it("ignores files that are not json and folders", () => {
    writeRecipe(root, scanRecipe("alpha"));
    writeFileSync(join(root, "README.md"), "# notes");
    writeFileSync(join(root, "alpha.scan.v1.json.bak"), "{}");
    mkdirSync(join(root, "nested.json"));
    writeRecipe(join(root, "nested"), scanRecipe("beta"));
    const { recipes, errors } = loadRecipesFromDir(root, "bundled");
    expect(errors).toEqual([]);
    expect(recipes.map((r) => r.recipe.id)).toEqual(["alpha.scan.v1"]);
  });

  it("reports invalid json and keeps loading the rest", () => {
    writeRecipe(root, scanRecipe("alpha"));
    writeFileSync(join(root, "broken.scan.v1.json"), "{ not json");
    const { recipes, errors } = loadRecipesFromDir(root, "bundled");
    expect(recipes).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.file).toBe(join(root, "broken.scan.v1.json"));
    expect(errors[0]?.message).toMatch(/Not valid JSON/);
  });

  it("reports schema violations with their paths", () => {
    const bad = { ...scanRecipe("alpha"), entryUrl: "javascript:alert(1)", steps: [] };
    writeRecipe(root, bad);
    const { recipes, errors } = loadRecipesFromDir(root, "bundled");
    expect(recipes).toEqual([]);
    expect(errors[0]?.message).toBe("Recipe does not match the schema");
    expect(errors[0]?.issues?.map((i) => i.path[0])).toEqual(
      expect.arrayContaining(["entryUrl", "steps"]),
    );
  });

  it("rejects a file whose name does not match the recipe id", () => {
    writeRecipe(root, scanRecipe("alpha"), "alpha-scan.json");
    const { recipes, errors } = loadRecipesFromDir(root, "bundled");
    expect(recipes).toEqual([]);
    expect(errors[0]?.message).toBe("File must be named alpha.scan.v1.json");
  });

  it("reports a missing directory", () => {
    const { recipes, errors } = loadRecipesFromDir(join(root, "nope"), "extra");
    expect(recipes).toEqual([]);
    expect(errors).toEqual([{ file: join(root, "nope"), message: "Recipe directory not found" }]);
  });
});

describe("loadRecipes", () => {
  it("merges the bundled and extra directories", () => {
    writeRecipe(join(root, "bundled"), scanRecipe("alpha"));
    writeRecipe(join(root, "extra"), scanRecipe("beta"));
    const { recipes, errors } = loadRecipes({
      dir: join(root, "bundled"),
      extraDir: join(root, "extra"),
    });
    expect(errors).toEqual([]);
    expect(recipes.map((r) => [r.recipe.id, r.origin])).toEqual([
      ["alpha.scan.v1", "bundled"],
      ["beta.scan.v1", "extra"],
    ]);
  });

  it("lets an extra recipe replace a bundled one with the same id", () => {
    writeRecipe(join(root, "bundled"), scanRecipe("alpha", 1, "bundled"));
    writeRecipe(join(root, "extra"), scanRecipe("alpha", 1, "local fix"));
    const { recipes } = loadRecipes({ dir: join(root, "bundled"), extraDir: join(root, "extra") });
    expect(recipes).toHaveLength(1);
    expect(recipes[0]).toMatchObject({ origin: "extra" });
    expect(recipes[0]?.recipe.notes).toBe("local fix");
  });

  it("keeps different versions side by side", () => {
    writeRecipe(join(root, "bundled"), scanRecipe("alpha", 1));
    writeRecipe(join(root, "extra"), scanRecipe("alpha", 2));
    const { recipes } = loadRecipes({ dir: join(root, "bundled"), extraDir: join(root, "extra") });
    expect(recipes.map((r) => r.recipe.id)).toEqual(["alpha.scan.v1", "alpha.scan.v2"]);
  });

  it("reports errors from both directories without losing good recipes", () => {
    writeRecipe(join(root, "bundled"), scanRecipe("alpha"));
    mkdirSync(join(root, "extra"));
    writeFileSync(join(root, "extra", "x.scan.v1.json"), "nope");
    const result = loadRecipes({ dir: join(root, "bundled"), extraDir: join(root, "extra") });
    expect(result.recipes).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it("reports an extra directory that does not exist", () => {
    const { errors } = loadRecipes({ dir: root, extraDir: join(root, "missing") });
    expect(errors).toHaveLength(1);
  });

  it("tolerates a missing bundled directory and a null extra directory", () => {
    expect(loadRecipes({ dir: join(root, "none"), extraDir: null })).toEqual({
      recipes: [],
      errors: [],
    });
  });

  it("loads whatever ships with the package without errors", () => {
    const { errors } = loadRecipes();
    expect(errors).toEqual([]);
    expect(BUNDLED_RECIPES_DIR.endsWith("/recipes")).toBe(true);
  });
});
