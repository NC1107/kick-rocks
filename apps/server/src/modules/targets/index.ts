import { registerNotImplemented } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";

export const targetsModule: ModulePlugin = (app) => {
  registerNotImplemented(app, "targets");
};
