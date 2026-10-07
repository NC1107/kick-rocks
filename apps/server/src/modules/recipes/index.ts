import { API_ROUTES } from "@kickrocks/shared";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import { registerCanaryHealth } from "./canary-health.js";
import { createRecipeStore } from "./store.js";
import { syncRecipes } from "./sync.js";

export const recipesModule: ModulePlugin = (app, services) => {
  const store = createRecipeStore(services);

  // Recipes point at targets, so they are stored after the targets are synced, not here.
  services.startup.onReady("recipes", () => {
    syncRecipes(services);
  });
  registerCanaryHealth(services);

  registerRoute(app, API_ROUTES.recipesList, ({ query }) => ({
    recipes: store.list({ status: query.status }),
  }));
  registerRoute(app, API_ROUTES.recipesApprove, ({ params }) => store.approve(params.id));
  registerRoute(app, API_ROUTES.recipesReject, ({ params }) => store.reject(params.id));
};
