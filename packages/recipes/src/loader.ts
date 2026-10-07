import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ApiIssue, Recipe } from "@kickrocks/shared";

export type RecipeOrigin = "bundled" | "extra";

export interface LoadedRecipe {
  recipe: Recipe;
  file: string;
  origin: RecipeOrigin;
}

export interface RecipeLoadError {
  file: string;
  message: string;
  issues?: ApiIssue[];
}

export interface LoadRecipesResult {
  recipes: LoadedRecipe[];
  errors: RecipeLoadError[];
}

export interface LoadRecipesOptions {
  /** Defaults to the recipes shipped with this package. */
  dir?: string;
  /** A second directory of recipes, for fixtures and power users. */
  extraDir?: string | null;
}

/** The recipes shipped with the package, next to `src` and `dist` alike. */
export const BUNDLED_RECIPES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "recipes",
);

function loadFile(path: string, origin: RecipeOrigin): LoadedRecipe | RecipeLoadError {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { file: path, message: `Not valid JSON: ${(error as Error).message}` };
  }
  const parsed = Recipe.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.filter((p): p is string | number => typeof p !== "symbol"),
      message: issue.message,
    }));
    return { file: path, message: "Recipe does not match the schema", issues };
  }
  const expected = `${parsed.data.id}.json`;
  if (basename(path) !== expected) {
    return { file: path, message: `File must be named ${expected}` };
  }
  return { recipe: parsed.data, file: path, origin };
}

/** Loads every `*.json` file directly inside a directory; other files and folders are ignored. */
export function loadRecipesFromDir(dir: string, origin: RecipeOrigin): LoadRecipesResult {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { recipes: [], errors: [{ file: dir, message: "Recipe directory not found" }] };
  }
  const result: LoadRecipesResult = { recipes: [], errors: [] };
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  for (const name of files) {
    const loaded = loadFile(join(dir, name), origin);
    if ("recipe" in loaded) result.recipes.push(loaded);
    else result.errors.push(loaded);
  }
  return result;
}

/**
 * Loads the bundled recipes, then the extra directory. A recipe in the extra directory replaces a
 * bundled one with the same id, which is how a power user overrides a broken recipe locally.
 * A bad file is reported and skipped so one typo cannot take the server down.
 */
export function loadRecipes(options: LoadRecipesOptions = {}): LoadRecipesResult {
  const bundledDir = options.dir ?? BUNDLED_RECIPES_DIR;
  const bundled = existsSync(bundledDir)
    ? loadRecipesFromDir(bundledDir, "bundled")
    : { recipes: [], errors: [] };
  const extra = options.extraDir
    ? loadRecipesFromDir(options.extraDir, "extra")
    : { recipes: [], errors: [] };

  const byId = new Map<string, LoadedRecipe>();
  for (const loaded of [...bundled.recipes, ...extra.recipes]) byId.set(loaded.recipe.id, loaded);
  return {
    recipes: Array.from(byId.values()).sort((a, b) => a.recipe.id.localeCompare(b.recipe.id)),
    errors: [...bundled.errors, ...extra.errors],
  };
}
