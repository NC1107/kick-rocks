import { API_ROUTES } from "@kickrocks/shared";
import { defineMockDomain, handle, MockHttpError } from "./core.js";

const MAX_FAILED_LOGINS = 5;

/**
 * Mock instance password: kickrocks-mock. Five wrong passwords in a row answer 429 until
 * /__mock/reset, so the throttled state can be seen. The mock starts signed in; set
 * KICKROCKS_MOCK_AUTH=login or =setup, or open /__mock/auth?mode=login, to start elsewhere.
 */
export default defineMockDomain({
  name: "auth",
  routes: (store) => [
    handle(API_ROUTES.authState, () => ({
      setupRequired: store.auth.setupRequired,
      authenticated: store.auth.authenticated,
    })),

    handle(API_ROUTES.authSetup, ({ body }) => {
      if (!store.auth.setupRequired) {
        throw new MockHttpError(409, "conflict", "This instance already has a password.");
      }
      store.auth.password = body.password;
      store.auth.setupRequired = false;
      store.auth.authenticated = true;
      return { ok: true as const };
    }),

    handle(API_ROUTES.authLogin, ({ body }) => {
      if (store.auth.failedLogins >= MAX_FAILED_LOGINS) {
        throw new MockHttpError(
          429,
          "rate_limited",
          "Too many attempts. Wait a minute, then try again.",
        );
      }
      if (store.auth.password === null || body.password !== store.auth.password) {
        store.auth.failedLogins += 1;
        throw new MockHttpError(401, "unauthorized", "That password is not right.");
      }
      store.auth.failedLogins = 0;
      store.auth.authenticated = true;
      return { ok: true as const };
    }),

    handle(API_ROUTES.authLogout, () => {
      store.auth.authenticated = false;
      return { ok: true as const };
    }),

    handle(API_ROUTES.authPassword, ({ body }) => {
      if (body.currentPassword !== store.auth.password) {
        throw new MockHttpError(403, "forbidden", "The current password is not right.");
      }
      store.auth.password = body.newPassword;
      return { ok: true as const };
    }),
  ],
});
