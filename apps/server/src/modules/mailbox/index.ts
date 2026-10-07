import { registerNotImplemented } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";

export const mailboxModule: ModulePlugin = (app) => {
  registerNotImplemented(app, "mailbox");
};
