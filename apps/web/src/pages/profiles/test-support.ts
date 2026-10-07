interface RequestLike {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: string | undefined;
}

interface ResponseLike {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array | string;
}

/** The part of the mock app a page test needs to watch or break. It is declared here so this file never pulls the mock into the app build. */
export interface Instrumentable {
  handle(request: RequestLike): Promise<ResponseLike>;
}

export interface Recorded extends RequestLike {
  json: unknown;
}

/**
 * Wraps a mock app so a test can watch what the page sent, and make one route answer with an
 * error. `fail.match` is a "METHOD /path" prefix of the request, such as "PUT /api/profiles".
 */
export function instrument(
  mock: Instrumentable,
  fail?: { match: string; status: number; body: unknown },
): Recorded[] {
  const seen: Recorded[] = [];
  const handle = mock.handle.bind(mock);
  mock.handle = async (request) => {
    seen.push({ ...request, json: request.body ? JSON.parse(request.body) : undefined });
    if (fail && `${request.method} ${request.url}`.startsWith(fail.match)) {
      return {
        status: fail.status,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fail.body),
      };
    }
    return handle(request);
  };
  return seen;
}
