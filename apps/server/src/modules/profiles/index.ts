import { registerNotImplemented } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";

export const profilesModule: ModulePlugin = (app) => {
  registerNotImplemented(app, "profiles");
};
