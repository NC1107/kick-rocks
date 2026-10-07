import {
  API_ROUTES,
  type ApiIssue,
  type IdentityInput,
  validateIdentities,
} from "@kickrocks/shared";
import type { Clock } from "../../core/clock.js";
import { invalidRequest } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import { createProfileStore, identityKey } from "./store.js";

/**
 * Rules the shared schema cannot hold: a date of birth is not in the future, which needs today's
 * date, and no fact is listed twice, which a list of independent items cannot see.
 */
function identityIssues(inputs: readonly IdentityInput[], clock: Clock): ApiIssue[] {
  const today = clock.now().toISOString().slice(0, 10);
  const issues = validateIdentities(inputs, today).map((issue) => ({
    path: ["body", "identities", ...issue.path],
    message: issue.message,
  }));
  const seen = new Set<string>();
  inputs.forEach((input, index) => {
    const key = identityKey(input);
    if (seen.has(key)) {
      issues.push({ path: ["body", "identities", index], message: "This is listed twice" });
    }
    seen.add(key);
  });
  return issues;
}

function requireValid(inputs: readonly IdentityInput[], clock: Clock): void {
  const issues = identityIssues(inputs, clock);
  if (issues.length > 0) throw invalidRequest("The identities are not valid", issues);
}

export const profilesModule: ModulePlugin = (app, { db, clock }) => {
  const store = createProfileStore({ db, clock });

  registerRoute(app, API_ROUTES.profilesList, () => ({ profiles: store.list() }));

  registerRoute(app, API_ROUTES.profilesCreate, ({ body }) => {
    requireValid(body.identities, clock);
    return store.create(body);
  });

  registerRoute(app, API_ROUTES.profilesGet, ({ params }) => store.get(params.id));

  registerRoute(app, API_ROUTES.profilesUpdate, ({ params, body }) =>
    store.update(params.id, body),
  );

  registerRoute(app, API_ROUTES.profilesReplaceIdentities, ({ params, body }) => {
    requireValid(body.identities, clock);
    return store.replaceIdentities(params.id, body.identities);
  });

  registerRoute(app, API_ROUTES.profilesDelete, ({ params }) => {
    store.remove(params.id);
    return { ok: true as const };
  });
};
