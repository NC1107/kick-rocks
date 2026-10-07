import { registerNotImplemented } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";

export const recipesModule: ModulePlugin = (app) => {
  registerNotImplemented(app, "recipes");
};
