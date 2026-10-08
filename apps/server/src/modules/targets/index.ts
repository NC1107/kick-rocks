import { API_ROUTES } from "@kickrocks/shared";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import { createTargetCatalog } from "./service.js";

export const targetsModule: ModulePlugin = (app, services) => {
  const catalog = createTargetCatalog(services.db, services.targets);

  registerRoute(app, API_ROUTES.targetsList, ({ query }) => catalog.list(query));
  registerRoute(app, API_ROUTES.targetsFacets, () => catalog.facets());
  registerRoute(app, API_ROUTES.targetsGet, ({ params }) => catalog.detail(params.id));
  registerRoute(app, API_ROUTES.targetsSite, ({ params }) => {
    services.targets.getOrThrow(params.id);
    const domain = services.politeness.domainOf(params.id);
    return { site: domain === null ? null : services.politeness.siteStatus(domain) };
  });
};
