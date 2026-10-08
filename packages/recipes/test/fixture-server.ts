import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** Pages that answer with a status other than 200, as a broker's error and bot pages do. */
const STATUS: Record<string, number> = {
  "/rec/gone": 404,
  "/mail/missing": 404,
  "/mail/expired": 410,
  "/wall/cloudflare": 403,
  "/wall/denied": 403,
  "/wall/blank": 403,
  "/wall/blank-redirect": 403,
  "/boom": 500,
  "/limited": 429,
  "/limited-redirect": 429,
  "/unavailable": 503,
};

/** Where a form post lands, since the pages are static files. */
const POST_RESPONSES: Record<string, string> = {
  "/form/submit": "/form/done",
  "/ps/remove": "/ps/removed",
  "/rec/remove": "/rec/done",
  "/mail/send": "/mail/sent",
  "/frame/submit": "/frame/done",
  "/verify/submit": "/rec/done",
  "/form/reject-submit": "/form/rejected",
  "/mail/press-submit": "/mail/confirm",
  "/mail/press-stale-submit": "/mail/stale",
  "/mail/press-limited-submit": "/limited",
  "/mail/press-forbidden-submit": "/wall/blank",
  "/mail/press-unavailable-submit": "/unavailable",
};

/** Posts the site turns away instead of taking. */
const POST_STATUS: Record<string, number> = {
  "/mail/press-limited-submit": 429,
  "/mail/press-forbidden-submit": 403,
  "/mail/press-unavailable-submit": 503,
};

export interface Submission {
  path: string;
  fields: Record<string, string>;
}

export interface FixtureServer {
  /** `http://127.0.0.1:<port>`, an address on the loopback interface. */
  origin: string;
  /** The same server under a different host name, which is not on the origin's domain. */
  otherOrigin: string;
  /** Every form post the server received, in order. */
  submissions: Submission[];
  /** Every request, as `METHOD path?query`. */
  hits: string[];
  close: () => Promise<void>;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function sendFile(response: ServerResponse, path: string, status: number): Promise<void> {
  const clean = path.replace(/\/+$/, "");
  const relative = extname(clean) ? clean : `${clean || "/index"}.html`;
  const file = normalize(join(FIXTURES, relative));
  if (!file.startsWith(FIXTURES + sep)) {
    response.writeHead(400).end();
    return;
  }
  try {
    const body = await readFile(file);
    const type = extname(file) === ".svg" ? "image/svg+xml" : "text/html; charset=utf-8";
    response.writeHead(status, { "content-type": type });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Not found</title><h1>Not found</h1>");
  }
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const submissions: Submission[] = [];
  const hits: string[] = [];

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.local");
    hits.push(`${request.method} ${url.pathname}${url.search}`);

    if (request.method === "POST") {
      const fields = Object.fromEntries(new URLSearchParams(await readBody(request)));
      submissions.push({ path: url.pathname, fields });
      const next = POST_RESPONSES[url.pathname];
      if (POST_STATUS[url.pathname] === 429) response.setHeader("retry-after", "120");
      await sendFile(response, next ?? "/missing", POST_STATUS[url.pathname] ?? (next ? 200 : 404));
      return;
    }
    if (url.pathname === "/echo") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>Echo</title><p id="query">${escapeHtml(url.search)}</p>`);
      return;
    }
    if (url.pathname === "/redirect") {
      response.writeHead(302, { location: url.searchParams.get("to") ?? "/" }).end();
      return;
    }
    if (url.pathname.startsWith("/captcha/widget/")) {
      await sendFile(response, "/captcha/widget", 200);
      return;
    }
    if (url.pathname === "/limited" || url.pathname === "/limited-redirect")
      response.setHeader("retry-after", "120");
    if (url.pathname === "/unavailable") response.setHeader("retry-after", "30");
    if (url.pathname === "/wall/cloudflare") {
      response.setHeader("cf-mitigated", "challenge");
    }
    await sendFile(response, url.pathname, STATUS[url.pathname.replace(/\/+$/, "")] ?? 200);
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    otherOrigin: `http://localhost:${port}`,
    submissions,
    hits,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
