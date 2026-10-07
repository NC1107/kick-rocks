import { registerNotImplemented } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";

export const authModule: ModulePlugin = (app) => {
  registerNotImplemented(app, "auth");
};
