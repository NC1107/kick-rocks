import { API_ROUTES } from "@kickrocks/shared";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import { createRequestsApi } from "./service.js";

export const requestsModule: ModulePlugin = (app, services) => {
  const api = createRequestsApi(services);

  registerRoute(app, API_ROUTES.requestsList, ({ params, query }) => api.list(params.id, query));
  registerRoute(app, API_ROUTES.requestsGet, ({ params }) => api.detail(params.id));
  registerRoute(app, API_ROUTES.requestsAct, ({ params, body }) => api.act(params.id, body.action));
  registerRoute(app, API_ROUTES.requestsVerification, ({ params, body }) =>
    api.replyToVerification(params.id, body),
  );
};
