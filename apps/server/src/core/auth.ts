import type { FastifyRequest } from "fastify";

export type AuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string; message?: string };

/**
 * Decides whether a request to the cookie-authenticated API may proceed. The guard calls it for
 * every /api route except /api/health, /api/auth/*, and /api/worker/*. A 403 is for a request that
 * is signed in but missing the CSRF header; a 401 is for a missing or expired session.
 */
export interface AuthService {
  authenticate(request: FastifyRequest): AuthResult | Promise<AuthResult>;
}
