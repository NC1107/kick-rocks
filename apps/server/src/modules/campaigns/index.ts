import { API_ROUTES } from "@kickrocks/shared";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import { createCampaignService } from "./service.js";

export const campaignsModule: ModulePlugin = (app, services) => {
  const campaigns = createCampaignService(services);

  registerRoute(app, API_ROUTES.campaignsPreview, ({ params, body }) =>
    campaigns.preview(params.id, body),
  );
  registerRoute(app, API_ROUTES.campaignsCreate, ({ params, body }) =>
    campaigns.create(params.id, body),
  );
};
