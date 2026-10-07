import { NotImplementedError } from "@kickrocks/shared";
import type { CanaryRunner, RecipeRunner } from "../types.js";

export const runRecipe: RecipeRunner = () => {
  throw new NotImplementedError("runRecipe");
};

export const runCanary: CanaryRunner = () => {
  throw new NotImplementedError("runCanary");
};
