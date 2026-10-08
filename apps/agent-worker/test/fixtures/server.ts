import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The global setup lets the operating system pick the fixture site's port and publishes it here before any test
 * file loads, so no test depends on a port being free. It is 0 only in the setup process, which never reads it.
 */
export const FIXTURE_PORT_ENV = "KICKROCKS_FIXTURE_PORT";
export const FIXTURE_PORT = Number(process.env[FIXTURE_PORT_ENV] ?? 0);

export interface FixtureOrigins {
  origin: string;
  offsite: string;
  other: string;
}

export function originsOf(port: number): FixtureOrigins {
  return {
    origin: `http://127.0.0.1:${port}`,
    offsite: `http://localhost:${port}`,
    other: `http://other.test:${port}`,
  };
}

const own = originsOf(FIXTURE_PORT);
/** The target's domain in tests. `localhost` is another host name for the same server, so it plays an unrelated site. */
export const ORIGIN = own.origin;
export const OFFSITE = own.offsite;
/** A third host, which the test browser maps to this server, for tests where two hosts are allowed and a third is not. */
export const OTHER = own.other;

/** How long the slow form's endpoint keeps a visitor waiting after it has taken the submission. */
const SLOW_RESPONSE_MS = 3_000;

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

const here = dirname(fileURLToPath(import.meta.url));

const PAGES: Record<string, string> = {
  "/optout": "optout.html",
  "/confirmation": "confirmation.html",
  "/search": "search.html",
  "/captcha": "captcha.html",
  "/recaptcha/api2/anchor": "recaptcha-frame.html",
  "/interstitial": "interstitial.html",
  "/clearing": "clearing.html",
  "/login": "login.html",
  "/upload": "upload.html",
  "/dialog": "dialog.html",
  "/injection": "injection.html",
  "/offsite": "offsite.html",
  "/popup": "popup.html",
  "/privacy": "privacy.html",
  "/alert": "alert.html",
  "/choose": "choose.html",
  "/phone": "phone.html",
  "/late": "late.html",
  "/frames": "frames.html",
  "/slow-form": "slow.html",
  "/hops": "hops.html",
  "/oopif": "oopif.html",
  "/framed": "framed.html",
  "/wandering": "wandering.html",
  "/nested": "nested.html",
  "/spa": "spa.html",
  "/xhr-search": "xhr-search.html",
  "/details": "details.html",
  "/sw-register": "sw-register.html",
  "/sw-form": "sw-form.html",
  "/sw-evade": "sw-evade.html",
  "/sw-popup-form": "sw-popup-form.html",
  "/sw-popup-blank": "sw-popup-blank.html",
  "/sw-popup-named": "sw-popup-named.html",
  "/sw-popup-flood": "sw-popup-flood.html",
  "/sw-popup-open-first": "sw-popup-open-first.html",
  "/return-link": "return-link.html",
  "/onchange": "onchange.html",
  "/onchange-select": "onchange-select.html",
  "/onchange-check": "onchange-check.html",
  "/onchange-fetch": "onchange-fetch.html",
  "/save-link": "save-link.html",
  "/icon-submit": "icon-submit.html",
  "/long-label": "long-label.html",
  "/late-captcha": "late-captcha.html",
  "/cookie-banner": "cookie-banner.html",
  "/long-form": "long-form.html",
  "/detail-selects": "detail-selects.html",
  "/late-captcha-change": "late-captcha-change.html",
  "/bottom-banner": "bottom-banner.html",
  "/custom-lists": "custom-lists.html",
  "/dob-selects": "dob-selects.html",
  "/many-links": "many-links.html",
  "/huge-page": "huge-page.html",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function renderPage(
  hosts: FixtureOrigins,
  file: string,
  extra: Record<string, string> = {},
): string {
  const values: Record<string, string> = {
    ORIGIN: hosts.origin,
    OFFSITE: hosts.offsite,
    OTHER: hosts.other,
    GREETING: "",
    ...extra,
  };
  return readFileSync(join(here, file), "utf8").replace(
    /\{\{(\w+)\}\}/g,
    (_, key: string) => values[key] ?? "",
  );
}

function longPage(): string {
  const paragraphs = Array.from(
    { length: 400 },
    (_, i) => `<p>Paragraph ${i} of a very long page about nothing in particular.</p>`,
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Long page</title></head><body><h1>Long page</h1>${paragraphs.join("")}<button type="button">Last button</button></body></html>`;
}

async function readForm(request: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
}

function send(response: ServerResponse, status: number, body: string, type = "text/html") {
  response.writeHead(status, { "content-type": `${type}; charset=utf-8` });
  response.end(body);
}

/** A tiny broker site, served from `127.0.0.1` so `localhost` can stand in for a different domain. */
export function startFixtureServer(): Promise<{
  server: Server;
  port: number;
  close: () => Promise<void>;
}> {
  const state: FixtureState = { submissions: [], hits: [] };

  const server = createServer(async (request, response) => {
    const hosts = originsOf((server.address() as AddressInfo).port);
    const page = (file: string, extra?: Record<string, string>) => renderPage(hosts, file, extra);
    const url = new URL(request.url ?? "/", hosts.origin);
    const host = (request.headers.host ?? "").split(":")[0] ?? "";
    const path = url.pathname;

    if (path === "/__state") return send(response, 200, JSON.stringify(state), "application/json");
    if (path === "/__reset") {
      state.submissions = [];
      state.hits = [];
      return send(response, 200, "{}", "application/json");
    }
    if (path !== "/favicon.ico") state.hits.push({ host, path });

    if (path === "/hop307") {
      // A 307 keeps the method and the body, so a form posted here is posted again at the target.
      response.writeHead(307, { location: `${hosts.other}/collect` });
      return response.end();
    }
    if (path === "/hop302") {
      const name = url.searchParams.get("name") ?? "";
      response.writeHead(302, {
        location: `${hosts.other}/collect?name=${encodeURIComponent(name)}`,
      });
      return response.end();
    }
    if (request.method === "POST") {
      state.submissions.push({ path, host, fields: await readForm(request) });
      if (path === "/slow") await new Promise((done) => setTimeout(done, SLOW_RESPONSE_MS));
      return send(response, 200, page("confirmation.html"));
    }
    if (path === "/hang") return;
    if (path === "/limited") {
      response.writeHead(429, { "content-type": "text/html", "retry-after": "180" });
      return response.end("<!doctype html><title>Slow down</title><h1>Too many requests</h1>");
    }
    if (path === "/cf-challenge") {
      response.writeHead(403, { "content-type": "text/html", "cf-mitigated": "challenge" });
      return response.end("<!doctype html><title>Just a moment...</title><h1>Checking</h1>");
    }
    if (path === "/sw.js") return send(response, 200, page("sw.js"), "text/javascript");
    if (path === "/redirect") {
      response.writeHead(302, { location: `${hosts.offsite}/offsite` });
      return response.end();
    }
    if (path === "/go") {
      response.writeHead(302, { location: `${hosts.origin}/forms/a/start` });
      return response.end();
    }
    if (path.startsWith("/forms/a/")) return send(response, 200, page("form-a.html"));
    if (path.startsWith("/forms/b/")) return send(response, 200, page("form-b.html"));
    if (path === "/long") return send(response, 200, longPage());
    if (path === "/echo") {
      const name = url.searchParams.get("name");
      return send(
        response,
        200,
        page("echo.html", { GREETING: name === null ? "" : `Hello, ${escapeHtml(name)}.` }),
      );
    }
    if (path.startsWith("/people/")) return send(response, 200, page("record.html"));
    const file = PAGES[path];
    if (file) return send(response, 200, page(file));
    return send(response, 404, "<!doctype html><title>Not found</title><h1>Not found</h1>");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
