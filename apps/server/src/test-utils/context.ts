import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LegalApi } from "@kickrocks/legal";
import {
  type ApiError,
  buildRoutePath,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  type RouteBodyInput,
  type RouteDef,
  type RouteQueryInput,
  type RouteResponse,
} from "@kickrocks/shared";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { buildApp, openAppDatabase } from "../app.js";
import { loadConfig } from "../config.js";
import type { TargetSources } from "../core/targets.js";
import { type AppServices, createServices } from "../services.js";
import { DEFAULT_TEST_NOW, FakeClock } from "./clock.js";
import { FakeAuth } from "./fake-auth.js";
import { createFakeLegal } from "./fake-legal.js";
import { createFakeMail, type FakeMail } from "./fake-mail.js";

export const TEST_WORKER_TOKEN = "test-worker-token-0123456789";
export const TEST_MCP_TOKEN = "test-mcp-token-0123456789abcdef";

export interface TestContextOptions {
  /** The fake clock's starting time. */
  now?: Date | string;
  /** Extra environment for the server config, such as KICKROCKS_EXTRA_TARGETS. */
  env?: Record<string, string>;
  /** Datasets for the startup sync. Empty by default so tests start with no targets. */
  targetSources?: TargetSources;
  /** Runs before the app is made ready, the only time a route or hook can still be added. */
  beforeReady?: (app: FastifyInstance) => void | Promise<void>;
}

export interface RequestOptions {
  method?: InjectOptions["method"];
  /** Path with the /api prefix, for example `/api/profiles`. */
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
}

export type ApiResult<R extends RouteDef> =
  | {
      ok: true;
      status: number;
      body: R extends { binary: readonly string[] } ? Buffer : RouteResponse<R>;
      response: LightMyRequestResponse;
    }
  | { ok: false; status: number; body: ApiError; response: LightMyRequestResponse };

export interface CallInput<R extends RouteDef> {
  /** Values for the `:name` parts of the path. */
  params?: Record<string, string>;
  query?: RouteQueryInput<R>;
  body?: RouteBodyInput<R>;
}

export interface TestContext {
  services: AppServices;
  /** The Fastify instance, already ready. */
  app: FastifyInstance;
  clock: FakeClock;
  mail: FakeMail;
  legal: LegalApi;
  /** Starts allowing everything; use `auth.deny()` to test an anonymous caller. */
  auth: FakeAuth;
  workerToken: string;
  mcpToken: string;
  /** A request as a signed-in browser would make it: the CSRF header is added. */
  inject(options: RequestOptions): Promise<LightMyRequestResponse>;
  /** A request carrying the worker bearer token. */
  injectWorker(options: RequestOptions): Promise<LightMyRequestResponse>;
  /** A request carrying the MCP bearer token. MCP is enabled in the test context. */
  injectMcp(options: RequestOptions): Promise<LightMyRequestResponse>;
  /**
   * Calls a route from the shared table with the right credentials for it. A successful response
   * is parsed through the route's schema, so a handler that breaks the contract fails the test.
   */
  call<R extends RouteDef>(route: R, input?: CallInput<R>): Promise<ApiResult<R>>;
  close(): Promise<void>;
}

function toInject(options: RequestOptions, extraHeaders: Record<string, string>): InjectOptions {
  const inject: InjectOptions = {
    method: options.method ?? "GET",
    url: options.url,
    headers: { ...extraHeaders, ...options.headers },
  };
  if (options.payload !== undefined)
    inject.payload = options.payload as NonNullable<InjectOptions["payload"]>;
  return inject;
}

/**
 * Builds the whole server against a temporary encrypted database, a fake clock, and fake mail,
 * with the scheduler off. Close it in `afterEach`.
 */
export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), "kickrocks-test-"));
  const config = loadConfig({
    KICKROCKS_DATA_DIR: dir,
    KICKROCKS_PUBLIC_URL: "http://kickrocks.test",
    KICKROCKS_WORKER_TOKEN: TEST_WORKER_TOKEN,
    KICKROCKS_SCHEDULER: "off",
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
    ...options.env,
  });

  const clock = new FakeClock(options.now ?? DEFAULT_TEST_NOW);
  const mail = createFakeMail(clock);
  const legal = createFakeLegal();
  const auth = new FakeAuth();
  const database = openAppDatabase(config);
  const services = createServices(config, database.db, {
    clock,
    mail: mail.services,
    legal,
    auth,
    targetSources: options.targetSources ?? {
      brokers: () => ({ version: "test", records: [] }),
      companies: () => ({ version: "test", records: [] }),
    },
  });
  services.settings.set("mcp.enabled", true);
  services.settings.set("mcp.tokenHash", services.secrets.hashToken(TEST_MCP_TOKEN));

  const built = await buildApp({ services, database, version: "test" });
  await options.beforeReady?.(built.server);
  await built.server.ready();

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const csrf = { [CSRF_HEADER]: CSRF_HEADER_VALUE };

  const context: TestContext = {
    services,
    app: built.server,
    clock,
    mail,
    legal,
    auth,
    workerToken: TEST_WORKER_TOKEN,
    mcpToken: TEST_MCP_TOKEN,
    inject: (request) => built.server.inject(toInject(request, csrf)),
    injectWorker: (request) => built.server.inject(toInject(request, bearer(TEST_WORKER_TOKEN))),
    injectMcp: (request) => built.server.inject(toInject(request, bearer(TEST_MCP_TOKEN))),

    async call(route, input = {}) {
      const pairs = Object.entries((input.query ?? {}) as Record<string, unknown>)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)] as [string, string]);
      const query = pairs.length > 0 ? `?${new URLSearchParams(pairs).toString()}` : "";
      const request: RequestOptions = {
        method: route.method,
        url: `/api${buildRoutePath(route.path, input.params)}${query}`,
        ...(input.body === undefined ? {} : { payload: input.body }),
      };
      const response =
        route.auth === "worker"
          ? await context.injectWorker(request)
          : await context.inject(request);
      if (response.statusCode >= 400) {
        return {
          ok: false,
          status: response.statusCode,
          body: response.json() as ApiError,
          response,
        };
      }
      const body = route.binary ? response.rawPayload : route.response?.parse(response.json());
      return { ok: true, status: response.statusCode, body, response } as ApiResult<typeof route>;
    },

    async close() {
      await built.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return context;
}
