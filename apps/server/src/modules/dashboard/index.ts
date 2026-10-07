import { registerNotImplemented } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";

export const dashboardModule: ModulePlugin = (app) => {
  registerNotImplemented(app, "dashboard");
};
