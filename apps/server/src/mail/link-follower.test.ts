import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLinkFollower, type HostResolver, isPrivateAddress } from "./link-follower.js";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let server: Server;
let port: number;
let handler: Handler;
let seen: Array<{ host: string; url: string; cookie: string | undefined }>;

function mapped(table: Record<string, string>): HostResolver {
  return async (hostname) => {
    const address = table[hostname];
    if (!address) throw Object.assign(new Error("no such host"), { code: "ENOTFOUND" });
    return [{ address, family: address.includes(":") ? 6 : 4 }];
  };
}

beforeEach(async () => {
  seen = [];
  handler = (_request, response) => {
    response
      .writeHead(200, { "content-type": "text/html" })
      .end("<p>Your request is confirmed.</p>");
  };
  server = createServer((request, response) => {
    seen.push({
      host: request.headers.host ?? "",
      url: request.url ?? "",
      cookie: request.headers.cookie,
    });
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function follower(options: Partial<Parameters<typeof createLinkFollower>[0]> = {}) {
  return createLinkFollower({
    allowedPrivateHosts: ["broker.test", "www.broker.test"],
    resolve: mapped({ "broker.test": "127.0.0.1", "www.broker.test": "127.0.0.1" }),
    ...options,
  });
}

const link = (path: string, host = "broker.test") => `http://${host}:${port}${path}`;

describe("a link that works", () => {
  it("follows it and reports where it ended up", async () => {
    const result = await follower().follow(link("/confirm?token=abc"), ["broker.test"]);
    expect(result).toEqual({
      ok: true,
      finalUrl: link("/confirm?token=abc"),
      status: 200,
      needsBrowser: false,
      reason: null,
    });
    expect(seen).toEqual([
      { host: `broker.test:${port}`, url: "/confirm?token=abc", cookie: undefined },
    ]);
  });

  it("follows redirects that stay on the allowed domains", async () => {
    handler = (request, response) => {
      if (request.url === "/start") response.writeHead(302, { location: "/middle" }).end();
      else if (request.url === "/middle") {
        response.writeHead(301, { location: link("/done", "www.broker.test") }).end();
      } else response.writeHead(200, { "content-type": "text/html" }).end("<p>Done, thanks.</p>");
    };
    const result = await follower().follow(link("/start"), ["broker.test"]);
    expect(result.ok).toBe(true);
    expect(result.finalUrl).toBe(link("/done", "www.broker.test"));
    expect(seen.map((entry) => entry.url)).toEqual(["/start", "/middle", "/done"]);
  });

  it("carries a cookie set on one hop to the next", async () => {
    handler = (request, response) => {
      if (request.url === "/start") {
        response
          .writeHead(302, { location: "/next", "set-cookie": "session=abc123; Path=/" })
          .end();
      } else if (request.headers.cookie === "session=abc123") {
        response
          .writeHead(200, { "content-type": "text/html" })
          .end("<p>Confirmed with a session.</p>");
      } else response.writeHead(403).end();
    };
    expect((await follower().follow(link("/start"), ["broker.test"])).ok).toBe(true);
  });

  it("decodes a compressed page", async () => {
    handler = (_request, response) => {
      response
        .writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" })
        .end(gzipSync("<p>You have been removed from the list.</p>"));
    };
    expect(await follower().follow(link("/x"), ["broker.test"])).toMatchObject({
      ok: true,
      needsBrowser: false,
    });
  });

  it("stops reading a page that is larger than the limit instead of waiting for it", async () => {
    handler = (_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.write("<p>Confirmed.</p>");
      const filler = Buffer.alloc(64 * 1024, "a");
      const timer = setInterval(() => response.write(filler), 1);
      response.on("close", () => clearInterval(timer));
    };
    const result = await follower({ maxBytes: 128 * 1024 }).follow(link("/big"), ["broker.test"]);
    expect(result.ok).toBe(true);
  });
});

describe("a link it refuses", () => {
  it("never connects to a private address unless the host is configured", async () => {
    const result = await follower({ allowedPrivateHosts: [] }).follow("http://broker.test/x", [
      "broker.test",
    ]);
    expect(result).toMatchObject({ ok: false, finalUrl: null, status: null, needsBrowser: false });
    expect(result.reason).toMatch(/private or local/);
    expect(seen).toEqual([]);
  });

  it("refuses a host whose name resolves to several addresses when one is private", async () => {
    const resolve: HostResolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ];
    const result = await follower({ allowedPrivateHosts: [], resolve }).follow(
      "http://broker.test/x",
      ["broker.test"],
    );
    expect(result.reason).toMatch(/private or local/);
    expect(seen).toEqual([]);
  });

  it("refuses a redirect to a site that is not allowed, without asking that site", async () => {
    handler = (_request, response) => {
      response.writeHead(302, { location: link("/phish", "evil.test") }).end();
    };
    const result = await follower({
      resolve: mapped({ "broker.test": "127.0.0.1", "evil.test": "127.0.0.1" }),
    }).follow(link("/start"), ["broker.test"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/evil\.test is not one of the sites/);
    expect(seen.map((entry) => entry.host)).toEqual([`broker.test:${port}`]);
  });

  it("refuses a lookalike domain at the first hop", async () => {
    const result = await follower({
      resolve: mapped({ "notbroker.test": "127.0.0.1" }),
      allowedPrivateHosts: ["notbroker.test"],
    }).follow(link("/x", "notbroker.test"), ["broker.test"]);
    expect(result.ok).toBe(false);
    expect(seen).toEqual([]);
  });

  it("refuses a redirect from an allowed domain to a private address", async () => {
    handler = (_request, response) => {
      response.writeHead(302, { location: `http://169.254.169.254/latest/meta-data` }).end();
    };
    const result = await follower().follow(link("/start"), ["broker.test", "169.254.169.254"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/private or local/);
    expect(seen).toHaveLength(1);
  });

  it("refuses a subdomain that resolves somewhere private when only the apex is configured", async () => {
    const result = await follower({
      resolve: mapped({ "broker.test": "127.0.0.1", "sub.broker.test": "10.1.2.3" }),
    }).follow("http://sub.broker.test/x", ["broker.test"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/private or local/);
  });

  it("gives up on a redirect loop", async () => {
    handler = (_request, response) => {
      response.writeHead(302, { location: "/again" }).end();
    };
    const result = await follower({ maxRedirects: 3 }).follow(link("/again"), ["broker.test"]);
    expect(result).toMatchObject({ ok: false, reason: "The link redirected too many times." });
    expect(seen).toHaveLength(4);
  });

  it("refuses links it should never open", async () => {
    const f = follower();
    const allowed = ["broker.test", "10.0.0.1"];
    expect((await f.follow("ftp://broker.test/file", allowed)).reason).toMatch(/web links/);
    expect((await f.follow("javascript:alert(1)", allowed)).ok).toBe(false);
    expect((await f.follow("not a url", allowed)).reason).toMatch(/not a valid address/);
    expect((await f.follow("https://user:pass@broker.test/", allowed)).reason).toMatch(
      /carry a login/,
    );
    expect((await f.follow(`https://broker.test/${"a".repeat(3000)}`, allowed)).reason).toMatch(
      /too long/,
    );
    expect((await f.follow("http://10.0.0.1/confirm", allowed)).reason).toMatch(/private or local/);
    expect((await f.follow("https://broker.test/x", [])).reason).toMatch(/No site is allowed/);
    expect(seen).toEqual([]);
  });

  it("refuses unusual ports on a host that is not configured as private", async () => {
    const result = await createLinkFollower({
      allowedPrivateHosts: [],
      resolve: mapped({ "broker.test": "93.184.216.34" }),
    }).follow("http://broker.test:8081/x", ["broker.test"]);
    expect(result.reason).toMatch(/unusual ports/);
  });
});

describe("a link that fails", () => {
  it("reports an error status", async () => {
    handler = (_request, response) => {
      response.writeHead(404).end("missing");
    };
    expect(await follower().follow(link("/gone"), ["broker.test"])).toMatchObject({
      ok: false,
      status: 404,
      needsBrowser: false,
      reason: "The page answered with status 404.",
    });
  });

  it("gives up on a page that never answers", async () => {
    handler = () => {};
    const result = await follower({ timeoutMs: 150 }).follow(link("/slow"), ["broker.test"]);
    expect(result).toMatchObject({ ok: false, reason: "The page took too long to answer." });
  });

  it("reports a host that cannot be found", async () => {
    const result = await createLinkFollower({
      allowedPrivateHosts: [],
      resolve: mapped({}),
    }).follow("https://broker.test/x", ["broker.test"]);
    expect(result).toMatchObject({ ok: false, reason: "The site's address could not be found." });
  });

  it("reports a refused connection", async () => {
    const result = await follower().follow("http://broker.test:1/x", ["broker.test"]);
    expect(result).toMatchObject({ ok: false, reason: "The site refused the connection." });
  });
});

describe("whether a browser is needed", () => {
  async function pageNeeding(html: string, headers: Record<string, string> = {}, status = 200) {
    handler = (_request, response) => {
      response.writeHead(status, { "content-type": "text/html", ...headers }).end(html);
    };
    return follower().follow(link("/page"), ["broker.test"]);
  }

  it("is not needed for a plain confirmation page", async () => {
    const result = await pageNeeding(
      "<html><body><h1>Request confirmed</h1><p>Your listing will be removed within 48 hours.</p><a href='/'>Home</a></body></html>",
    );
    expect(result).toMatchObject({ ok: true, needsBrowser: false, reason: null });
  });

  it("is not needed for a file that is not a web page", async () => {
    handler = (_request, response) => {
      response.writeHead(200, { "content-type": "application/pdf" }).end("%PDF-1.4");
    };
    expect(await follower().follow(link("/receipt.pdf"), ["broker.test"])).toMatchObject({
      ok: true,
      needsBrowser: false,
    });
  });

  it("is needed when a button has to be pressed to confirm", async () => {
    const result = await pageNeeding(
      "<form method='post' action='/confirm'><p>Confirm your opt-out request</p><button type='submit'>Confirm removal</button></form>",
    );
    expect(result).toMatchObject({ ok: true, needsBrowser: true });
    expect(result.reason).toMatch(/button/);
  });

  it("is needed for a page that is an empty shell rendered by script", async () => {
    const result = await pageNeeding(
      "<html><body><div id='root'></div><script src='/app.js'></script></body></html>",
    );
    expect(result).toMatchObject({ ok: true, needsBrowser: true });
    expect(result.reason).toMatch(/script/);
  });

  it("is needed when the page says it requires JavaScript", async () => {
    const result = await pageNeeding(
      "<body><p>Confirm</p><noscript>Please enable JavaScript to continue.</noscript></body>",
    );
    expect(result.needsBrowser).toBe(true);
  });

  it("is needed when the page moves on with a meta refresh", async () => {
    const result = await pageNeeding(
      "<head><meta http-equiv='refresh' content='0; url=/next'></head><body></body>",
    );
    expect(result.needsBrowser).toBe(true);
  });

  it("is needed when the page shows a CAPTCHA", async () => {
    const result = await pageNeeding(
      "<body><p>Prove you are a person to continue with this long enough sentence.</p><div class='g-recaptcha'></div></body>",
    );
    expect(result).toMatchObject({ ok: true, needsBrowser: true });
    expect(result.reason).toMatch(/human check/);
  });

  it("is needed, and the follow failed, when the site answers a challenge with 403", async () => {
    const result = await pageNeeding(
      "<title>Just a moment...</title>",
      { "cf-mitigated": "challenge" },
      403,
    );
    expect(result).toMatchObject({ ok: false, status: 403, needsBrowser: true });
  });

  it("fails, without a browser, on a page that says the link expired", async () => {
    const result = await pageNeeding(
      "<h1>Sorry</h1><p>This link has expired. Please request a new one.</p>",
    );
    expect(result).toMatchObject({ ok: false, needsBrowser: false });
    expect(result.reason).toMatch(/expired or is not valid/);
  });
});

describe("isPrivateAddress", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::1",
    "2001:db8::1",
    "::127.0.0.1",
    "::7f00:1",
    "::a00:1",
    "::ffff:0:7f00:1",
    "::ffff:0:a00:1",
    "64:ff9b:1::a00:1",
    "100::1",
    "2001::1",
    "2001:1::1",
    "5f00::1",
    "not an address",
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "172.15.0.1",
    "172.32.0.1",
    "100.63.0.1",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    "::ffff:0:808:808",
    "2001:4860:4860::8888",
    "2001:200::1",
  ])("treats %s as public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});
