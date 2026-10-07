import { registerNotImplemented } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";

export const workerApiModule: ModulePlugin = (app) => {
  registerNotImplemented(app, "worker-api");
};
