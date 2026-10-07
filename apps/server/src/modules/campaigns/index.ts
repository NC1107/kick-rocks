import { registerNotImplemented } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";

export const campaignsModule: ModulePlugin = (app) => {
  registerNotImplemented(app, "campaigns");
};
