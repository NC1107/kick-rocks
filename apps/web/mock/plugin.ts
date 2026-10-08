import type { IncomingMessage } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import type { MockApp, MockRequest } from "./app.js";
import type { MockAuthMode } from "./store.js";

interface KickRocksMockOptions {
  /** Milliseconds added to every answer. Defaults to KICKROCKS_MOCK_LATENCY, else 150. */
  latencyMs?: number;
  /** Where the mock starts: signed in, at the login page, or at first-run setup. */
  auth?: MockAuthMode;
}

const AUTH_MODES: readonly MockAuthMode[] = ["authed", "login", "setup"];

function readOptions(options: KickRocksMockOptions): Required<KickRocksMockOptions> {
  const envLatency = Number(process.env.KICKROCKS_MOCK_LATENCY);
  const envAuth = process.env.KICKROCKS_MOCK_AUTH as MockAuthMode | undefined;
  return {
    latencyMs:
      options.latencyMs ??
      (Number.isFinite(envLatency) && envLatency >= 0 && process.env.KICKROCKS_MOCK_LATENCY
        ? envLatency
        : 150),
    auth: options.auth ?? (envAuth && AUTH_MODES.includes(envAuth) ? envAuth : "authed"),
  };
}

async function readBody(request: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : undefined;
}

/**
 * Answers /api/* from the handler modules in apps/web/mock, so the UI can be built without the
 * server. Enabled by `pnpm --filter @kickrocks/web dev:mock`; never part of a build.
 *
 * The handlers load through Vite's module graph, so saving a file in apps/web/mock replaces the
 * mock the next request: fixtures re-seed and edited handlers apply without a restart.
 *
 * POST /__mock/reset puts the fixtures back. GET /__mock/auth?mode=login|setup|authed jumps the
 * session to a state, for testing the auth gate.
 */
export function kickRocksMock(options: KickRocksMockOptions = {}): Plugin {
  const settings = readOptions(options);
  let current: { module: object; app: MockApp } | undefined;

  async function appFor(server: ViteDevServer): Promise<MockApp> {
    const loaded = (await server.ssrLoadModule("/mock/app.ts")) as typeof import("./app.js");
    if (current?.module !== loaded) {
      current = {
        module: loaded,
        app: loaded.createMockApp({ latencyMs: settings.latencyMs, auth: settings.auth }),
      };
    }
    return current.app;
  }

  return {
    name: "kickrocks-mock",
    apply: "serve",
    configureServer(server) {
      server.config.logger.info(
        `  Mock API on: /api/* answers from apps/web/mock (latency ${settings.latencyMs}ms, start ${settings.auth})`,
      );
      server.middlewares.use(async (request, response, next) => {
        const url = request.url ?? "";
        if (!(url.startsWith("/api/") || url.startsWith("/__mock/"))) return next();

        try {
          const app = await appFor(server);

          if (url.startsWith("/__mock/")) {
            const path = new URL(url, "http://mock.local");
            if (path.pathname === "/__mock/reset" && request.method === "POST") {
              app.reset();
            } else if (path.pathname === "/__mock/auth") {
              const mode = path.searchParams.get("mode") as MockAuthMode | null;
              if (!mode || !AUTH_MODES.includes(mode)) {
                response.statusCode = 400;
                response.end("mode must be authed, login, or setup");
                return;
              }
              app.reset();
              app.store.auth.setupRequired = mode === "setup";
              app.store.auth.authenticated = mode === "authed";
              app.store.auth.password = mode === "setup" ? null : app.store.auth.password;
            } else {
              response.statusCode = 404;
              response.end("unknown mock control");
              return;
            }
            response.statusCode = 200;
            response.setHeader("content-type", "application/json");
            response.end('{"ok":true}');
            return;
          }

          const headers: MockRequest["headers"] = {};
          for (const [name, value] of Object.entries(request.headers)) {
            headers[name] = Array.isArray(value) ? value.join(", ") : value;
          }
          const result = await app.handle({
            method: request.method ?? "GET",
            url,
            headers,
            body: await readBody(request),
          });
          response.statusCode = result.status;
          for (const [name, value] of Object.entries(result.headers))
            response.setHeader(name, value);
          response.end(result.body);
        } catch (error) {
          server.config.logger.error(
            `[mock] ${error instanceof Error ? error.stack : String(error)}`,
          );
          response.statusCode = 500;
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              error: "internal_error",
              message: "The mock server failed to load. See the dev server log.",
            }),
          );
        }
      });
    },
  };
}
