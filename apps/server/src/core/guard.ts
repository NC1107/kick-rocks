import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthService } from "./auth.js";
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
 * Which credential a path needs. The path is read as sent and percent-decoded, with duplicate
 * slashes collapsed and dot segments resolved, so no spelling of a path can pick a weaker rule
 * than the router would give the route it reaches.
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

/**
 * The single place that decides who may call what: the session for the web API, the worker
 * token for /api/worker/*, and the MCP token for /mcp. Nothing else under /api is reachable
 * without passing here.
 */
export function registerGuards(app: FastifyInstance, { auth, secrets }: GuardServices): void {
  app.addHook("onRequest", async (request, reply) => {
    switch (guardFor(request.url)) {
      case "none":
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
        const result = await auth.authenticate(request);
        if (!result.ok) {
          return reply.code(result.status).send({
            error: result.error,
            ...(result.message ? { message: result.message } : {}),
          });
        }
        return;
      }
    }
  });
}
