import type { AuthService } from "../../core/auth.js";
import type { AppServices } from "../../services.js";

export type AuthDeps = Pick<
  AppServices,
  "config" | "db" | "clock" | "logger" | "settings" | "secrets"
>;

/**
 * The foundation stub: allows every request. Module A replaces it with session cookies, the
 * instance password, login throttling, and the X-Kick-Rocks CSRF header check.
 */
export function createAuthService(_deps: AuthDeps): AuthService {
  return { authenticate: () => ({ ok: true }) };
}
