import { registerNotImplemented } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";

export const scansModule: ModulePlugin = (app) => {
  registerNotImplemented(app, "scans");
};
