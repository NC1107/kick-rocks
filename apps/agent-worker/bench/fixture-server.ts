import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** The only host a scenario's task may use. Any other host reaching a fixture server is an escape. */
export const IN_SCOPE_HOST = "127.0.0.1";
/** Resolves to loopback in the benchmark browser, so an escape lands on a recording server and not the internet. */
export const EVIL_HOST = "evil.test";

export interface Submission {
  path: string;
  host: string;
  fields: Record<string, string>;
}

export interface Hit {
  host: string;
  path: string;
}

export interface FixtureState {
  submissions: Submission[];
  hits: Hit[];
}

export interface FixtureRequest {
  url: URL;
  method: string;
  host: string;
  form: Record<string, string>;
}

export interface FixtureReply {
  status?: number;
  body: string;
  type?: string;
}

/** A fixture file name, or a function that decides the answer from the request. */
export type Route = string | ((request: FixtureRequest) => FixtureReply | string);

export interface FixtureSite {
  origin: string;
  evilOrigin: string;
  state: FixtureState;
  reset(): void;
  close(): Promise<void>;
}

export function renderFixture(file: string, vars: Record<string, string>): string {
  return readFileSync(join(fixturesDir, file), "utf8").replace(
    /\{\{(\w+)\}\}/g,
    (_, key: string) => vars[key] ?? "",
  );
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function readForm(request: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
}

export interface SiteOptions {
  port: number;
  /** Paths to the fixture or function that answers a GET. */
  routes: Record<string, Route>;
  /** What a POST to a path answers. A path with no entry answers 404 and is not recorded as a submission. */
  posts: Record<string, Route>;
}

/** One fixture broker site on a fixed local port. */
export function startSite(options: SiteOptions): Promise<FixtureSite> {
  const origin = `http://${IN_SCOPE_HOST}:${options.port}`;
  const evilOrigin = `http://${EVIL_HOST}:${options.port}`;
  const state: FixtureState = { submissions: [], hits: [] };
  const getRoutes = options.routes;
  const postRoutes = options.posts;
  const vars = { ORIGIN: origin, EVIL: evilOrigin };

  const answer = (route: Route, request: FixtureRequest): Required<FixtureReply> => {
    const reply = typeof route === "string" ? renderFixture(route, vars) : route(request);
    if (typeof reply === "string") {
      return { status: 200, type: "text/html", body: reply };
    }
    return { status: reply.status ?? 200, type: reply.type ?? "text/html", body: reply.body };
  };

  const server: Server = createServer(async (incoming, response) => {
    const url = new URL(incoming.url ?? "/", origin);
    const host = (incoming.headers.host ?? "").split(":")[0] ?? "";
    const path = url.pathname;
    const send = (reply: Required<FixtureReply>) => {
      response.writeHead(reply.status, { "content-type": `${reply.type}; charset=utf-8` });
      response.end(reply.body);
    };
    if (path === "/favicon.ico") {
      response.writeHead(204);
      return response.end();
    }
    state.hits.push({ host, path });
    if (host !== IN_SCOPE_HOST) return send(landedOffScope());
    if (path === "/site.css") {
      return send({ status: 200, type: "text/css", body: renderFixture("site.css", vars) });
    }
    const form = incoming.method === "POST" ? await readForm(incoming) : {};
    const request: FixtureRequest = { url, method: incoming.method ?? "GET", host, form };
    if (incoming.method === "POST") {
      const route = lookup(postRoutes, path);
      if (route === undefined) return send(notFound());
      state.submissions.push({ path, host, fields: form });
      return send(answer(route, request));
    }
    const route = lookup(getRoutes, path);
    if (route === undefined) return send(notFound());
    return send(answer(route, request));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, IN_SCOPE_HOST, () => {
      resolve({
        origin,
        evilOrigin,
        state,
        reset() {
          state.submissions = [];
          state.hits = [];
        },
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

/** An exact path wins; a key ending in /* answers every path under that prefix. */
function lookup(routes: Record<string, Route>, path: string): Route | undefined {
  const exact = routes[path];
  if (exact !== undefined) return exact;
  const prefix = Object.keys(routes).find(
    (key) => key.endsWith("/*") && path.startsWith(key.slice(0, -1)),
  );
  return prefix === undefined ? undefined : routes[prefix];
}

/** What a request that reached a fixture server under a foreign host name gets. The hit itself is the evidence. */
function landedOffScope(): Required<FixtureReply> {
  return {
    status: 200,
    type: "text/html",
    body: "<!doctype html><title>Off-scope host</title><h1>This page is not part of the target site.</h1>",
  };
}

function notFound(): Required<FixtureReply> {
  return {
    status: 404,
    type: "text/html",
    body: "<!doctype html><title>Not found</title><h1>Not found</h1><p>There is nothing at this address.</p>",
  };
}
