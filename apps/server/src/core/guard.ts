import { CSRF_HEADER, CSRF_HEADER_VALUE, requiresCsrfHeader } from "@kickrocks/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthService } from "./auth.js";
import type { HostPolicy } from "./hosts.js";
import type { Secrets, TokenCheck } from "./secrets.js";

export type GuardKind = "none" | "session" | "worker" | "mcp";

/** Higher is stricter. When two readings of a path disagree the stricter one wins. */
const STRICTNESS: Record<GuardKind, number> = { none: 0, mcp: 1, worker: 1, session: 2 };

function classify(path: string): GuardKind {
  const pathname = path.replace(/\/{2,}/g, "/");
  if (pathname === "/mcp" || pathname.startsWith("/mcp/")) return "mcp";
  if (!pathname.startsWith("/api/")) return "none";
  const rest = pathname.slice("/api".length);
  if (rest === "/health" || rest.startsWith("/auth/")) return "none";
  if (rest.startsWith("/worker/")) return "worker";
  return "session";
}

function normalizePath(rawUrl: string): string {
  const target = rawUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "").split(/[?#]/, 1)[0] ?? "";
  const collapsed = target.replace(/\/{2,}/g, "/");
  return new URL(collapsed.startsWith("/") ? collapsed : `/${collapsed}`, "http://localhost")
    .pathname;
}

/**
 * Which credential a path needs, read from the path alone. A matched route says so itself, through
 * the shared route table (see `registerRoute`), and this is what applies to the rest: a path that
 * matches no route, so a 404 gives nothing away, and a route a module registered without declaring
 * one. The path is read as sent and percent-decoded, with duplicate slashes collapsed and dot
 * segments resolved, so no spelling of a path can pick a weaker rule than the router would give.
 */
export function guardFor(rawUrl: string): GuardKind {
  const pathname = normalizePath(rawUrl);
  let decoded = pathname;
  try {
    decoded = normalizePath(decodeURIComponent(pathname));
  } catch {
    // A malformed escape is not a path any route has, so the raw reading stands.
  }
  return [classify(pathname), classify(decoded)].reduce((a, b) =>
    STRICTNESS[b] > STRICTNESS[a] ? b : a,
  );
}

/** Whether a path, however it is spelled, is under /api. */
export function isApiPath(rawUrl: string): boolean {
  const pathname = normalizePath(rawUrl);
  let decoded = pathname;
  try {
    decoded = normalizePath(decodeURIComponent(pathname));
  } catch {
    // A malformed escape is not a path any route has, so the raw reading stands.
  }
  return [pathname, decoded].some((path) => path === "/api" || path.startsWith("/api/"));
}

interface DisabledReply {
  code: string;
  message: string;
}

function rejectToken(
  reply: FastifyReply,
  check: Exclude<TokenCheck, "ok">,
  disabled: DisabledReply,
) {
  if (check === "disabled") {
    return reply.code(503).send({ error: disabled.code, message: disabled.message });
  }
  return reply
    .code(401)
    .header("www-authenticate", "Bearer")
    .send({ error: "unauthorized", message: "A valid bearer token is required" });
}

const WORKER_DISABLED = {
  code: "worker_api_disabled",
  message: "The worker API is off. Set KICKROCKS_WORKER_TOKEN to turn it on.",
};
const MCP_DISABLED = {
  code: "mcp_disabled",
  message: "The MCP endpoint is off. Enable it and create a token in Settings.",
};

export interface GuardServices {
  auth: AuthService;
  secrets: Secrets;
}

function rejectCsrf(reply: FastifyReply) {
  return reply.code(403).send({
    error: "forbidden",
    message: `State-changing requests need the ${CSRF_HEADER} header`,
  });
}

/**
 * The single place that decides who may call what, and the one that enforces the CSRF header. A
 * route says what it needs in the shared route table: the session for the web API, the worker
 * token for /api/worker/*, the MCP token for /mcp. A request that matches no declared route is
 * judged by its path, and under /api that means a session. Nothing under /api is reachable without
 * passing here.
 *
 * The header (`X-Kick-Rocks`) is required on every method that changes state under /api, the auth
 * routes included, because a cross-site form can send neither a custom header nor, with SameSite,
 * the cookie. Bearer-token calls are exempt, since a browser never attaches those by itself. The
 * check runs before the body is parsed, so a body that Fastify would accept as text/plain never
 * reaches a handler from another site.
 */
export function registerGuards(
  app: FastifyInstance,
  { auth, secrets }: GuardServices,
  hostAllowed: HostPolicy,
): void {
  app.addHook("onRequest", async (request, reply) => {
    const declared = request.routeOptions.config?.auth;
    const kind: GuardKind = declared ?? guardFor(request.url);
    const csrfApplies =
      (declared !== undefined || isApiPath(request.url)) && kind !== "worker" && kind !== "mcp";
    const csrfMissing =
      csrfApplies &&
      requiresCsrfHeader({ method: request.method, auth: kind }) &&
      request.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE;

    // Bearer clients are not browsers, so they may use any name, such as a docker service name.
    if ((kind === "none" || kind === "session") && !hostAllowed(request.headers.host)) {
      return reply.code(421).send({
        error: "misdirected_request",
        message:
          "This server does not answer to that name. Set KICKROCKS_PUBLIC_URL or KICKROCKS_ALLOWED_HOSTS to the one you use.",
      });
    }

    switch (kind) {
      case "none":
        if (csrfMissing) return rejectCsrf(reply);
        return;
      case "worker": {
        const check = secrets.checkWorkerToken(request.headers.authorization);
        if (check !== "ok") return rejectToken(reply, check, WORKER_DISABLED);
        return;
      }
      case "mcp": {
        const check = secrets.checkMcpToken(request.headers.authorization);
        if (check !== "ok") return rejectToken(reply, check, MCP_DISABLED);
        return;
      }
      case "session": {
        const result = await auth.authenticate(request, reply);
        if (!result.ok) {
          return reply.code(result.status).send({
            error: result.error,
            ...(result.message ? { message: result.message } : {}),
          });
        }
        if (csrfMissing) return rejectCsrf(reply);
        return;
      }
    }
  });
}
