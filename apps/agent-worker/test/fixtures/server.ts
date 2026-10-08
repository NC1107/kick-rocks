import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
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
  method: string;
  /** The query string, without the question mark, so a test sees what a GET carried. */
  search: string;
  /** The raw body of a request that had one, so a test sees what a POST carried. */
  body: string;
}

export interface FixtureState {
  submissions: Submission[];
  hits: Hit[];
  /** Every WebSocket handshake the site accepted, and the text of every frame it then received. */
  wsUpgrades: string[];
  wsFrames: string[];
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
  "/gate-form": "gate-form.html",
  "/gate-delayed": "gate-delayed.html",
  "/gate-delayed-submit": "gate-delayed-submit.html",
  "/gate-get": "gate-get.html",
  "/gate-keys": "gate-keys.html",
  "/gate-worker": "gate-worker.html",
  "/gate-hop": "gate-hop.html",
  "/gate-encode": "gate-encode.html",
  "/gate-custom": "gate-custom.html",
  "/gate-step1": "gate-step1.html",
  "/gate-ws": "gate-ws.html",
  "/gate-nav": "gate-nav.html",
  "/gate-seed": "gate-seed.html",
  "/gate-storage": "gate-storage.html",
  "/gate-cookie": "gate-cookie.html",
  "/gate-third": "gate-third.html",
  "/gate-beacon": "gate-beacon.html",
  "/gate-worker-nested": "gate-worker-nested.html",
  "/gate-worker-file": "gate-worker-file.html",
  "/gate-shared": "gate-shared.html",
  "/gate-cross": "gate-cross.html",
  "/gate-frame": "gate-frame.html",
  "/gate-long": "gate-long.html",
  "/gate-noisy": "gate-noisy.html",
  "/gate-scope": "gate-scope.html",
  "/gate-popup": "gate-popup.html",
  "/gate-popup-blank": "popup.html",
  "/gate-sse": "gate-sse.html",
  "/gate-refresh": "gate-refresh.html",
  "/gate-blank-form": "gate-blank-form.html",
  "/gate-see-other": "gate-see-other.html",
  "/gate-push-state": "gate-push-state.html",
};

/** Scripts the gate pages load, served with a script type. */
const SCRIPTS: Record<string, string> = {
  "/gate-worker.js": "gate-worker.js",
  "/gate-worker-outer.js": "gate-worker-outer.js",
  "/gate-worker-inner.js": "gate-worker-inner.js",
  "/gate-shared.js": "gate-shared.js",
};

function token(): string {
  return randomBytes(18).toString("base64url");
}

function acceptKey(key: string): string {
  return createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
}

/** Reads the text frames a client sends; masked, short or long, which is all a test page sends. */
function readFrames(buffer: Buffer): string[] {
  const frames: string[] = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const opcode = (buffer[offset] ?? 0) & 0x0f;
    let length = (buffer[offset + 1] ?? 0) & 0x7f;
    const masked = ((buffer[offset + 1] ?? 0) & 0x80) !== 0;
    offset += 2;
    if (length === 126) {
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      length = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }
    const mask = masked ? buffer.subarray(offset, offset + 4) : null;
    offset += masked ? 4 : 0;
    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    offset += length;
    if (mask)
      for (let i = 0; i < payload.length; i++) payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
    if (opcode === 1) frames.push(payload.toString("utf8"));
  }
  return frames;
}

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
    PORT: new URL(hosts.origin).port,
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

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function parseForm(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
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
  const state: FixtureState = { submissions: [], hits: [], wsUpgrades: [], wsFrames: [] };

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
      state.wsUpgrades = [];
      state.wsFrames = [];
      return send(response, 200, "{}", "application/json");
    }
    const body = request.method === "POST" ? await readBody(request) : "";
    if (path !== "/favicon.ico") {
      state.hits.push({
        host,
        path,
        method: request.method ?? "GET",
        search: url.search.slice(1),
        body,
      });
    }

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
    if (path === "/gate-collect") {
      state.submissions.push({ path, host, fields: Object.fromEntries(url.searchParams) });
      return send(response, 200, "{}", "application/json");
    }
    if (path in SCRIPTS) {
      return send(response, 200, page(SCRIPTS[path] ?? ""), "text/javascript");
    }
    if (path === "/gate-csrf")
      return send(response, 200, page("gate-csrf.html", { CSRF: token() }));
    if (path === "/gate-see-other" && request.method === "POST") {
      response.writeHead(303, { location: `${ORIGIN}/gate-collect?after=303` });
      return response.end();
    }
    if (path === "/gate-hop" && request.method === "POST") {
      // A 307 sends the same body again, here to another page of the same site.
      response.writeHead(307, { location: `${ORIGIN}/gate-optout` });
      return response.end();
    }
    if (request.method === "POST") {
      state.submissions.push({ path, host, fields: parseForm(body) });
      if (path === "/slow") await new Promise((done) => setTimeout(done, SLOW_RESPONSE_MS));
      if (path === "/gate-step1-post") {
        return send(response, 200, page("gate-step2.html", { TICKET: token() }));
      }
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

  server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
    const key = request.headers["sec-websocket-key"];
    state.wsUpgrades.push(request.url ?? "");
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey(key)}`,
        "",
        "",
      ].join("\r\n"),
    );
    socket.on("data", (data: Buffer) => state.wsFrames.push(...readFrames(data)));
    socket.on("error", () => undefined);
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
