import { API_ROUTES } from "@kickrocks/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError, conflict, invalidRequest } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import type { AppServices } from "../../services.js";
import { hashPassword, needsRehash, verifyAgainstDummy, verifyPassword } from "./passwords.js";
import {
  clearSessionCookie,
  createSessionStore,
  sessionTokenOf,
  setSessionCookie,
} from "./sessions.js";
import { LoginThrottle, type ThrottleCheck } from "./throttle.js";

const NO_STORE = "no-store";

function throttled(reply: FastifyReply, check: Extract<ThrottleCheck, { allowed: false }>): never {
  reply.header("retry-after", String(check.retryAfterSeconds));
  throw new AppError(
    429,
    "rate_limited",
    `Too many attempts. Try again in ${formatWait(check.retryAfterSeconds)}.`,
  );
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export const authModule: ModulePlugin = (app, services: AppServices) => {
  const { settings, clock, config, db } = services;
  const sessions = createSessionStore({ db, clock });
  const loginThrottle = new LoginThrottle(clock);
  const passwordThrottle = new LoginThrottle(clock);
  const cookies = { publicUrl: config.publicUrl };

  const startSession = (request: FastifyRequest, reply: FastifyReply) => {
    const token = sessions.create(request.headers["user-agent"]);
    setSessionCookie(reply, request, token, cookies);
  };

  registerRoute(app, API_ROUTES.authState, ({ request, reply }) => {
    reply.header("cache-control", NO_STORE);
    const token = sessionTokenOf(request);
    const authenticated = sessions.touch(token);
    // Re-issuing the cookie is how its lifetime slides along with the server-side expiry.
    if (authenticated && token) setSessionCookie(reply, request, token, cookies);
    return { setupRequired: settings.get("auth.passwordHash") === null, authenticated };
  });

  registerRoute(app, API_ROUTES.authSetup, async ({ body, request, reply }) => {
    reply.header("cache-control", NO_STORE);
    if (settings.get("auth.passwordHash") !== null) {
      throw conflict("setup_already_done", "This instance already has a password.");
    }
    const hash = await hashPassword(body.password);
    // Hashing is async, so two setups can both pass the check above; the transaction is atomic.
    db.transaction(() => {
      if (settings.get("auth.passwordHash") !== null) {
        throw conflict("setup_already_done", "This instance already has a password.");
      }
      settings.set("auth.passwordHash", hash);
    });
    startSession(request, reply);
    return { ok: true as const };
  });

  registerRoute(app, API_ROUTES.authLogin, async ({ body, request, reply }) => {
    reply.header("cache-control", NO_STORE);
    const check = loginThrottle.attempt(request.ip);
    if (!check.allowed) throttled(reply, check);

    const stored = settings.get("auth.passwordHash");
    let valid = false;
    if (stored === null) await verifyAgainstDummy(body.password);
    else valid = await verifyPassword(stored, body.password);
    if (!valid) throw new AppError(401, "unauthorized", "That password is not right.");

    loginThrottle.succeed(request.ip);
    if (stored !== null && needsRehash(stored)) {
      settings.set("auth.passwordHash", await hashPassword(body.password));
    }
    startSession(request, reply);
    return { ok: true as const };
  });

  registerRoute(app, API_ROUTES.authLogout, ({ request, reply }) => {
    reply.header("cache-control", NO_STORE);
    sessions.destroy(sessionTokenOf(request));
    clearSessionCookie(reply, request, cookies);
    return { ok: true as const };
  });

  registerRoute(app, API_ROUTES.authPassword, async ({ body, request, reply }) => {
    reply.header("cache-control", NO_STORE);
    const check = passwordThrottle.attempt(request.ip);
    if (!check.allowed) throttled(reply, check);

    const stored = settings.get("auth.passwordHash");
    if (stored === null) throw conflict("setup_required", "This instance has no password yet.");
    // 403 rather than 401, because the web client treats 401 as "signed out" and leaves the page.
    if (!(await verifyPassword(stored, body.currentPassword))) {
      throw new AppError(403, "forbidden", "The current password is not right.");
    }
    if (body.newPassword === body.currentPassword) {
      throw invalidRequest("The new password must differ from the current one", [
        { path: ["body", "newPassword"], message: "Choose a password you are not using now" },
      ]);
    }
    passwordThrottle.succeed(request.ip);

    const hash = await hashPassword(body.newPassword);
    db.transaction(() => {
      settings.set("auth.passwordHash", hash);
      sessions.destroyAllExcept(null);
    });
    // Every other browser is signed out; this one gets a fresh token so the old one is dead too.
    startSession(request, reply);
    return { ok: true as const };
  });
};
