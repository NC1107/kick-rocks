import {
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  type IssueLocation,
  type RouteDef,
  requiresCsrfHeader,
  toApiIssues,
} from "@kickrocks/shared";
import {
  type MockBinary,
  type MockDomain,
  MockHttpError,
  MockReply,
  type MockRoute,
} from "./core.js";
import { MOCK_DOMAINS } from "./registry.js";
import { createStore, type MockAuthMode, type MockStore } from "./store.js";

export interface MockRequest {
  method: string;
  /** The path and query, such as "/api/profiles?x=1". */
  url: string;
  headers: Record<string, string | undefined>;
  /** The raw body text, if the request had one. */
  body: string | undefined;
}

export interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array | string;
}

export interface MockAppOptions {
  /** Added to every answer, so loading and skeleton states are visible. */
  latencyMs?: number;
  auth?: MockAuthMode;
  domains?: readonly MockDomain[];
}

export interface MockApp {
  readonly store: MockStore;
  /** Routes the mock answers, for tests that check coverage. */
  readonly routes: readonly MockRoute[];
  handle(request: MockRequest): Promise<MockResponse>;
  /** Throws away every change and seeds the fixtures again. */
  reset(): void;
}

interface CompiledRoute extends MockRoute {
  method: string;
  segments: string[];
}

const json = (status: number, body: unknown): MockResponse => ({
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

function errorResponse(error: MockHttpError): MockResponse {
  return json(error.status, {
    error: error.code,
    message: error.message,
    ...(error.issues ? { issues: error.issues } : {}),
  });
}

function compile(entry: MockRoute): CompiledRoute {
  return {
    ...entry,
    method: entry.route.method,
    segments: entry.route.path.split("/").filter(Boolean),
  };
}

/** Static segments win over :params, so /targets/facets is never read as a target id. */
function specificity(route: CompiledRoute): number {
  return route.segments.filter((segment) => segment.startsWith(":")).length;
}

function match(route: CompiledRoute, method: string, path: string): Record<string, string> | null {
  if (route.method !== method) return null;
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== route.segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < parts.length; index++) {
    const segment = route.segments[index] as string;
    const part = parts[index] as string;
    if (segment.startsWith(":")) params[segment.slice(1)] = decodeURIComponent(part);
    else if (segment !== part) return null;
  }
  return params;
}

/**
 * The mock server without any HTTP in it: give it a request, get a response. The Vite plugin adapts
 * Node's request objects to this, and the tests call it directly.
 *
 * It behaves like the real server where the UI can notice: session routes answer 401 when signed
 * out, state-changing routes answer 403 without X-Kick-Rocks, bad input answers 400 with issues,
 * and a handler whose answer breaks the shared schema answers 500 so the fixture gets fixed.
 */
export function createMockApp(options: MockAppOptions = {}): MockApp {
  const domains = options.domains ?? MOCK_DOMAINS;
  let store = createStore(options.auth);
  let compiled: CompiledRoute[] = [];

  function build() {
    store = createStore(options.auth);
    for (const domain of domains) domain.seed?.(store);
    const entries = domains.flatMap((domain) => domain.routes(store));
    const seen = new Set<RouteDef>();
    for (const entry of entries) {
      if (seen.has(entry.route)) {
        throw new Error(`Two mock domains answer ${entry.route.method} ${entry.route.path}`);
      }
      seen.add(entry.route);
    }
    compiled = entries.map(compile).sort((a, b) => specificity(a) - specificity(b));
    app.store = store;
    app.routes = entries;
  }

  async function dispatch(request: MockRequest): Promise<MockResponse> {
    const url = new URL(request.url, "http://mock.local");
    if (!url.pathname.startsWith("/api/")) {
      return json(404, { error: "not_found" });
    }
    const path = url.pathname.slice("/api".length);
    const method = request.method.toUpperCase();

    for (const route of compiled) {
      const rawParams = match(route, method, path);
      if (!rawParams) continue;
      return run(route, rawParams, url, request);
    }
    const known = compiled.some((route) => match(route, route.method, path));
    if (known) return json(405, { error: "method_not_allowed" });
    return json(501, {
      error: "not_implemented",
      message: `No mock handler for ${method} ${path}. Add one in apps/web/mock.`,
    });
  }

  async function run(
    entry: CompiledRoute,
    rawParams: Record<string, string>,
    url: URL,
    request: MockRequest,
  ): Promise<MockResponse> {
    const { route } = entry;
    try {
      if (route.auth === "session" && !store.auth.authenticated) {
        throw new MockHttpError(401, "unauthorized", "Sign in to continue.");
      }
      if (requiresCsrfHeader(route) && request.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) {
        throw new MockHttpError(403, "forbidden", `Missing the ${CSRF_HEADER} header.`);
      }

      const params = parseInput(route.params, rawParams, "params");
      const query = parseInput(route.query, Object.fromEntries(url.searchParams), "query");
      let body: unknown;
      if (route.body) {
        let raw: unknown;
        try {
          raw = request.body ? JSON.parse(request.body) : undefined;
        } catch {
          throw new MockHttpError(400, "invalid_request", "The body is not valid JSON.");
        }
        body = parseInput(route.body, raw, "body");
      }

      const result = await entry.handler({ params, query, body, store } as never);

      if (result instanceof MockReply) return json(result.status, result.body);

      if (isBinary(result)) {
        return {
          status: 200,
          headers: { "content-type": result.contentType, "cache-control": "no-store" },
          body: result.binary,
        };
      }
      if (route.response) {
        const checked = route.response.safeParse(result);
        if (!checked.success) {
          console.error(
            `[mock] ${route.method} ${route.path} returned data that breaks the shared schema:\n${checked.error.message}`,
          );
          return json(500, {
            error: "mock_contract_violation",
            message: `The mock for ${route.method} ${route.path} broke the shared response schema. See the dev server log.`,
            issues: toApiIssues(checked.error, "body"),
          });
        }
      }
      return json(route.status ?? 200, result);
    } catch (error) {
      if (error instanceof MockHttpError) return errorResponse(error);
      console.error(`[mock] ${route.method} ${route.path} threw`, error);
      return json(500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "The mock handler threw.",
      });
    }
  }

  function parseInput(schema: RouteDef["params"], raw: unknown, location: IssueLocation): unknown {
    if (!schema) return undefined;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new MockHttpError(
        400,
        "invalid_request",
        "Some of the details are not valid.",
        toApiIssues(parsed.error, location),
      );
    }
    return parsed.data;
  }

  const app: { store: MockStore; routes: readonly MockRoute[] } & Omit<
    MockApp,
    "store" | "routes"
  > = {
    store,
    routes: [],
    reset: () => build(),
    async handle(request) {
      if (options.latencyMs) await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
      return dispatch(request);
    },
  };
  build();
  return app;
}

function isBinary(value: unknown): value is MockBinary {
  return typeof value === "object" && value !== null && "binary" in value && "contentType" in value;
}
