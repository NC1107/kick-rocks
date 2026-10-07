import { registerNotImplemented } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";

export const reviewModule: ModulePlugin = (app) => {
  registerNotImplemented(app, "review");
};
