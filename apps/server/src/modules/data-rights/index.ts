import { API_ROUTES, profileExportFileName } from "@kickrocks/shared";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import { eraseInstance, eraseProfile } from "./erase.js";
import { exportProfile } from "./export.js";

export { applyRetention } from "./retention.js";
export { eraseProfile };

export const dataRightsModule: ModulePlugin = (app, services) => {
  registerRoute(app, API_ROUTES.profilesExport, ({ params, reply }) => {
    const file = exportProfile(services, params.id);
    reply.header("cache-control", "private, no-store");
    reply.header(
      "content-disposition",
      `attachment; filename="${profileExportFileName(file.profile.displayName, file.exportedAt)}"`,
    );
    return file;
  });

  registerRoute(app, API_ROUTES.settingsReset, () => {
    eraseInstance(services);
    return { ok: true as const };
  });
};
