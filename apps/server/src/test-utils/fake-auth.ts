import type { AuthResult, AuthService } from "../core/auth.js";

/**
 * Stands in for the real auth service so a module's route tests do not depend on the login
 * flow. Tests can switch it to deny and check that a route turns an anonymous caller away.
 */
export class FakeAuth implements AuthService {
  private result: AuthResult = { ok: true };

  authenticate(): AuthResult {
    return this.result;
  }

  allow(): void {
    this.result = { ok: true };
  }

  deny(status: 401 | 403 = 401, details: { error?: string; message?: string } = {}): void {
    this.result = {
      ok: false,
      status,
      error: details.error ?? (status === 401 ? "unauthorized" : "forbidden"),
      ...(details.message ? { message: details.message } : {}),
    };
  }
}
