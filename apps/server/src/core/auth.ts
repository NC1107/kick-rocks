import type { FastifyRequest } from "fastify";

export type AuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string; message?: string };

/**
 * Decides whether a request to the cookie-authenticated API has a valid session. The guard calls
 * it for every route whose entry in the shared route table says `session`, `/api/auth/password`
 * included, and for any /api path no route declares. It does not check the CSRF header: the guard
 * does that for every state-changing route, so no module has to remember to. Answer 401 for a
 * missing or expired session.
 */
export interface AuthService {
  authenticate(request: FastifyRequest): AuthResult | Promise<AuthResult>;
}
