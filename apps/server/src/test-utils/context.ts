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
  ScanningSettings,
} from "@kickrocks/shared";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { buildApp, openAppDatabase } from "../app.js";
import { loadConfig } from "../config.js";
import type { TargetSources } from "../core/targets.js";
import { type AppServices, createServices, type ServiceOverrides } from "../services.js";
import { DEFAULT_TEST_NOW, FakeClock } from "./clock.js";
import { FakeAuth } from "./fake-auth.js";
import { createFakeLegal } from "./fake-legal.js";
import { createFakeMail, type FakeMail } from "./fake-mail.js";

export const TEST_WORKER_TOKEN = "test-worker-token-0123456789";
export const TEST_MCP_TOKEN = "test-mcp-token-0123456789abcdef";

/** The smallest argon2id settings the library accepts, so signing in a hundred times is not a load test. */
const CHEAP_PASSWORD_COST = { timeCost: 1, memoryCost: 1024, parallelism: 1 };

const UNPACED_SCANNING = ScanningSettings.parse({
  minGapMinutes: 0,
  gapJitterPercent: 0,
  dailyCapPerSite: 100,
  hourlyCapTotal: 500,
  dailyCapTotal: 2000,
  quietStartHour: 0,
  quietEndHour: 0,
  reuseHours: 0,
});

interface TestContextOptions {
  /** The fake clock's starting time. */
  now?: Date | string;
  /** Extra environment for the server config, such as KICKROCKS_EXTRA_TARGETS. */
  env?: Record<string, string>;
  /**
   * `fake` (the default) lets `ctx.auth` allow or deny every session request, so a test of a
   * module does not depend on the login flow. `real` builds the server with its own auth service,
   * sessions, cookies, and throttling included, which is what the auth module tests.
   */
  auth?: "fake" | "real";
  /** Datasets for the startup sync. Empty by default so tests start with no targets. */
  targetSources?: TargetSources;
  /** Replacements for services the test needs to point at a local stand-in, such as ntfy. */
  overrides?: Pick<ServiceOverrides, "notificationChannels" | "random">;
  /**
   * `default` keeps the real politeness settings (spacing, caps, backoff). Any other value, and
   * the default of this option, removes the spacing and caps so a test can claim tasks freely.
   */
  politeness?: "default" | "off";
  /** Runs before the app is made ready, the only time a route or hook can still be added. */
  beforeReady?: (app: FastifyInstance) => void | Promise<void>;
}

export interface RequestOptions {
  method?: InjectOptions["method"];
  /** Path with the /api prefix, for example `/api/profiles`. */
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
  /**
   * Send the `X-Kick-Rocks` header, as the web app does on every state-changing call. On by
   * default for `inject`; pass `false` to see what the server does without it. Bearer-token calls
   * never send it.
   */
  csrf?: boolean;
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
  /**
   * Starts allowing everything; use `auth.deny()` to test an anonymous caller. With `auth: "real"`
   * the real service is in charge and calling `allow` or `deny` throws.
   */
  auth: FakeAuth;
  workerToken: string;
  mcpToken: string;
  /** A request as a signed-in browser would make it: the CSRF header is added unless `csrf: false`. */
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

/** Stands in for FakeAuth when the real service runs, so a test cannot steer an auth it does not own. */
class RealAuthPlaceholder extends FakeAuth {
  override allow(): never {
    throw new Error("auth is real in this context; sign in through the auth routes instead");
  }

  override deny(): never {
    throw new Error("auth is real in this context; sign out through the auth routes instead");
  }
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
  const realAuth = options.auth === "real";
  const auth = realAuth ? new RealAuthPlaceholder() : new FakeAuth();
  const database = openAppDatabase(config);
  const services = createServices(config, database.db, {
    clock,
    mail: mail.services,
    legal,
    passwordCost: CHEAP_PASSWORD_COST,
    ...options.overrides,
    ...(realAuth ? {} : { auth }),
    targetSources: options.targetSources ?? {
      brokers: () => ({ version: "test", records: [] }),
      companies: () => ({ version: "test", records: [] }),
    },
  });
  if (options.politeness !== "default") {
    // Most tests run many tasks against one fixture site back to back, which is exactly what the
    // gate exists to stop, so they run with the spacing and caps out of the way.
    services.settings.set("scanning", UNPACED_SCANNING);
  }
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
    inject: (request) => built.server.inject(toInject(request, request.csrf === false ? {} : csrf)),
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
      const expected = route.status ?? 200;
      if (response.statusCode !== expected) {
        throw new Error(
          `${route.method} ${route.path} answered ${response.statusCode}, but the route table says ${expected}`,
        );
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
