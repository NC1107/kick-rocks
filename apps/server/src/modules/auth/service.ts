import type { AuthResult, AuthService } from "../../core/auth.js";
import type { AppServices } from "../../services.js";
import { createSessionStore, sessionTokenOf, setSessionCookie } from "./sessions.js";

export type AuthDeps = Pick<
  AppServices,
  "config" | "db" | "clock" | "logger" | "settings" | "secrets"
>;

const UNAUTHENTICATED: AuthResult = {
  ok: false,
  status: 401,
  error: "unauthorized",
  message: "Sign in to continue",
};

/**
 * Cookie sessions. A request is signed in when its cookie names a live session, and every such
 * request pushes the session's expiry out, which is what makes the 30 days slide. The CSRF header
 * is the guard's business, not this service's.
 */
export function createAuthService(deps: AuthDeps): AuthService {
  const sessions = createSessionStore(deps);
  return {
    authenticate(request, reply) {
      const token = sessionTokenOf(request);
      if (!token || !sessions.touch(token)) return UNAUTHENTICATED;
      setSessionCookie(reply, request, token, { publicUrl: deps.config.publicUrl });
      return { ok: true };
    },
  };
}
