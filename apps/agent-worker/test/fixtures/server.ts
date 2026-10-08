import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Parallel checkouts on one machine set KICKROCKS_FIXTURE_PORT so their fixture sites do not collide. */
export const FIXTURE_PORT = Number(process.env.KICKROCKS_FIXTURE_PORT ?? 8631);
/** The target's domain in tests. `localhost` is another host name for the same server, so it plays an unrelated site. */
export const ORIGIN = `http://127.0.0.1:${FIXTURE_PORT}`;
export const OFFSITE = `http://localhost:${FIXTURE_PORT}`;
/** A third host, which the test browser maps to this server, for tests where two hosts are allowed and a third is not. */
export const OTHER = `http://other.test:${FIXTURE_PORT}`;

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
  "/late-captcha": "late-captcha.html",
  "/cookie-banner": "cookie-banner.html",
  "/long-form": "long-form.html",
  "/detail-selects": "detail-selects.html",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(file: string, extra: Record<string, string> = {}): string {
  const values: Record<string, string> = { ORIGIN, OFFSITE, OTHER, GREETING: "", ...extra };
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
export function startFixtureServer(port: number = FIXTURE_PORT): Promise<{
  server: Server;
  close: () => Promise<void>;
}> {
  const state: FixtureState = { submissions: [], hits: [] };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", ORIGIN);
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
      response.writeHead(307, { location: `${OTHER}/collect` });
      return response.end();
    }
    if (path === "/hop302") {
      const name = url.searchParams.get("name") ?? "";
      response.writeHead(302, { location: `${OTHER}/collect?name=${encodeURIComponent(name)}` });
      return response.end();
    }
    if (request.method === "POST") {
      state.submissions.push({ path, host, fields: await readForm(request) });
      if (path === "/slow") await new Promise((done) => setTimeout(done, SLOW_RESPONSE_MS));
      return send(response, 200, page("confirmation.html"));
    }
    if (path === "/hang") return;
    if (path === "/sw.js") return send(response, 200, page("sw.js"), "text/javascript");
    if (path === "/redirect") {
      response.writeHead(302, { location: `${OFFSITE}/offsite` });
      return response.end();
    }
    if (path === "/go") {
      response.writeHead(302, { location: `${ORIGIN}/forms/a/start` });
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
    server.listen(port, "127.0.0.1", () => {
      resolve({
        server,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
