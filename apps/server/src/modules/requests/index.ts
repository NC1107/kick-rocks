import { registerNotImplemented } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";

export const requestsModule: ModulePlugin = (app) => {
  registerNotImplemented(app, "requests");
};
