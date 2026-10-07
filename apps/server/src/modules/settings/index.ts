import { registerNotImplemented } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";

export const settingsModule: ModulePlugin = (app) => {
  registerNotImplemented(app, "settings");
};
