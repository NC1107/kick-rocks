import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { OutgoingRequest } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { createMask } from "../mask.js";
import { ValueDetector } from "./detector.js";
import {
  type BodyRead,
  canonicalize,
  headersWithShortReferer,
  type PausedRequest,
  readBody,
  ServedValues,
} from "./request.js";

const FIELDS = { first_name: "Jordan", email: "jordan.example@example.com", state: "TX" };
const detector = new ValueDetector(FIELDS);
const mask = createMask(FIELDS);

function paused(
  overrides: Partial<PausedRequest["request"]> = {},
  event: Partial<PausedRequest> = {},
): PausedRequest {
  return {
    requestId: "1",
    resourceType: "XHR",
    request: {
      url: "https://broker.test/api/optout?x=1",
      method: "POST",
      headers: {},
      ...overrides,
    },
    ...event,
  };
}

function bodyOf(text: string | Buffer): BodyRead {
  const bytes = typeof text === "string" ? Buffer.from(text) : text;
  return { bytes, present: true, unreadable: false };
}

function canonical(
  request: PausedRequest,
  body: BodyRead,
  served = new ServedValues(),
  party: "target" | "third" = "target",
) {
  return canonicalize({
    event: request,
    body,
    cookies: [],
    target: { type: "page", frameOrigin: "https://broker.test", topLevel: true },
    party,
    detector,
    mask,
    served,
  });
}

describe("canonicalize marks a request that was cut short", () => {
  const form = (pairs: string[]) =>
    canonical(
      paused({ headers: { "content-type": "application/x-www-form-urlencoded" } }),
      bodyOf(pairs.join("&")),
    );

  it("when the body holds more fields than are listed", () => {
    const padding = Array.from({ length: 400 }, (_, index) => `f${index}=1`);
    expect(form(padding).truncated).toBe(false);
    expect(form([...padding, "phone=5125550142"]).truncated).toBe(true);
  });

  it("when a value is longer than is kept", () => {
    expect(form([`note=${"a".repeat(4000)}`]).truncated).toBe(false);
    expect(form([`note=${"a".repeat(4001)}`]).truncated).toBe(true);
  });

  it("when a JSON body holds more leaves than are read", () => {
    const leaves = Object.fromEntries(Array.from({ length: 900 }, (_, index) => [`k${index}`, 1]));
    const result = canonical(
      paused({ headers: { "content-type": "application/json" } }),
      bodyOf(JSON.stringify(leaves)),
    );
    expect(result.truncated).toBe(true);
  });
});

describe("canonicalize places other than a value", () => {
  const EMAIL = "jordan.example@example.com";
  const hex = Buffer.from(EMAIL).toString("hex");
  const get = (url: string, headers: Record<string, string> = {}, party?: "target" | "third") =>
    canonical(
      paused({ url, method: "GET", headers }),
      { bytes: null, present: false, unreadable: false },
      new ServedValues(),
      party,
    );

  it("carries a value that is a query key and hides it in what is stored", () => {
    const { request, scan } = get(`https://broker.test/s?${encodeURIComponent(EMAIL)}=1`);
    expect(scan.contact).toBe(true);
    expect(request.carries).toContain("email");
    expect(JSON.stringify(request)).not.toContain(EMAIL);
    expect(JSON.stringify(request)).not.toContain("jordan.example%40");
  });

  it("carries a value that is a query key and is packed", () => {
    const { request, scan } = get(`https://broker.test/s?${hex}=1`);
    expect(scan.contact).toBe(true);
    expect(request.query[0]?.path).toMatch(/^\{\{email.*\}\} \(encoded\)$/);
    expect(JSON.stringify(request)).not.toContain(hex);
  });

  it("carries a value that is a header name", () => {
    const { request, scan } = get("https://broker.test/s", { [`x-${hex}`]: "1" });
    expect(scan.contact).toBe(true);
    expect(request.headers[0]?.path).toMatch(/^\{\{email.*\}\} \(encoded\)$/);
    expect(JSON.stringify(request)).not.toContain(hex);
  });

  it("carries a value that is a hex path segment and hides it in what is stored", () => {
    const { request, scan } = get(`https://broker.test/gate-collect/${hex}`);
    expect(scan.contact).toBe(true);
    expect(request.path).toMatch(/^\/gate-collect\/\{\{email.*\}\} \(encoded\)$/);
    expect(JSON.stringify(request)).not.toContain(hex);
  });

  it("carries a value that is a base64 path segment and hides it in what is stored", () => {
    const packed = Buffer.from(EMAIL).toString("base64url");
    const { request, scan } = get(`https://broker.test/a/${packed}/b`);
    expect(scan.contact).toBe(true);
    expect(request.path).toMatch(/^\/a\/\{\{email.*\}\} \(encoded\)\/b$/);
    expect(JSON.stringify(request)).not.toContain(packed);
  });

  it("leaves a path without a value as it was", () => {
    expect(get("https://broker.test/a/b%20c/").request.path).toBe("/a/b%20c/");
  });

  it("carries a value that is a subdomain label of the target", () => {
    const { request, scan } = get(`https://${hex}.broker.test/s`, {}, "target");
    expect(scan.contact).toBe(true);
    expect(request.host).toMatch(/^\{\{email.*\}\} \(encoded\)/);
    expect(JSON.stringify(request)).not.toContain(hex);
  });
});

describe("canonicalize", () => {
  it("shows a form body with the person's values as placeholders", () => {
    const { request } = canonical(
      paused({ headers: { "content-type": "application/x-www-form-urlencoded" } }),
      bodyOf("email=jordan.example%40example.com&kind=delete&state=TX"),
    );
    expect(request.bodyKind).toBe("form");
    expect(request.body).toEqual([
      // The first name is part of the address, so the address carries both.
      { path: "email", value: "{{email}}", class: "profile", fields: ["email", "first_name"] },
      { path: "kind", value: "delete", class: "literal" },
      { path: "state", value: "{{state}}", class: "profile", fields: ["state"] },
    ]);
    expect(request.carries).toEqual(["email", "first_name", "state"]);
    expect(JSON.stringify(request)).not.toContain("jordan.example");
  });

  it("flattens a json body into paths", () => {
    const { request } = canonical(
      paused({ headers: { "content-type": "application/json" } }),
      bodyOf(
        JSON.stringify({ user: { mail: "jordan.example@example.com", ids: [1, 2] }, ok: true }),
      ),
    );
    expect(request.bodyKind).toBe("json");
    expect(request.body.map((value) => [value.path, value.class])).toEqual([
      ["user.mail", "profile"],
      ["user.ids[0]", "literal"],
      ["user.ids[1]", "literal"],
      ["ok", "literal"],
    ]);
  });

  it("reads a multipart body by its field names", () => {
    const boundary = "xyz";
    const text = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="email"',
      "",
      "jordan.example@example.com",
      `--${boundary}`,
      'Content-Disposition: form-data; name="note"; filename="a.txt"',
      "",
      "hello",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const { request } = canonical(
      paused({ headers: { "content-type": `multipart/form-data; boundary=${boundary}` } }),
      bodyOf(text),
    );
    expect(request.bodyKind).toBe("multipart");
    expect(request.body.map((value) => [value.path, value.class])).toEqual([
      ["email", "profile"],
      ["note", "literal"],
    ]);
  });

  it("finds a value in a packed body and shows it as encoded", () => {
    const packed = gzipSync(Buffer.from("email=jordan.example%40example.com"));
    const { request, scan } = canonical(
      paused({
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "content-encoding": "gzip",
        },
      }),
      bodyOf(packed),
    );
    expect(scan.contact).toBe(true);
    expect(request.body[0]).toMatchObject({ path: "email", class: "profile" });
  });

  it("shows an encoded value as a placeholder rather than as the encoded text", () => {
    const encoded = Buffer.from("jordan.example@example.com").toString("base64");
    const { request } = canonical(
      paused({ headers: { "content-type": "application/x-www-form-urlencoded" } }),
      bodyOf(`blob=${encoded}`),
    );
    expect(request.body[0]).toMatchObject({ class: "profile" });
    expect(request.body[0]?.value).toMatch(/^\{\{email.*\}\} \(encoded\)$/);
    expect(JSON.stringify(request)).not.toContain(encoded);
  });

  it("calls a body it cannot make sense of opaque, and still looks inside it", () => {
    const binary = Buffer.concat([
      Buffer.from([0, 1, 2, 3, 250, 251]),
      Buffer.from("jordan.example@example.com"),
    ]);
    const { request, scan } = canonical(
      paused({ headers: { "content-type": "application/octet-stream" } }),
      bodyOf(binary),
    );
    expect(request.bodyKind).toBe("opaque");
    expect(scan.contact).toBe(true);
  });

  it("marks a value the site served as a token, and one it did not as a literal", () => {
    const served = new ServedValues();
    served.record(
      '<form><input type="hidden" name="csrf" value="k3J9xQ2mLw8TzP4vRb7YcN1d"><meta name="build" content="b-17"></form>',
      "text/html",
    );
    const { request } = canonical(
      paused({ headers: { "content-type": "application/x-www-form-urlencoded" } }),
      bodyOf("csrf=k3J9xQ2mLw8TzP4vRb7YcN1d&build=b-17&nonce=k3J9xQ2mLw8TzP4vRb7YcN1d"),
      served,
    );
    expect(request.body.map((value) => [value.path, value.class])).toEqual([
      ["csrf", "served_token"],
      ["build", "served_token"],
      ["nonce", "literal"],
    ]);
  });

  it("never treats the options of a group as per-load tokens", () => {
    const served = new ServedValues();
    served.record(
      '<input type="radio" name="scope" value="suppress_marketing_only_please"><input type="radio" name="scope" value="share_with_partner_brands_ok"><input type="hidden" name="ticket" value="k3J9xQ2mLw8TzP4vRb7YcN1d">',
      "text/html",
    );
    served.record(
      '{"records":["a1b2c3d4e5f6a7b8c9d0e1f2","f2e1d0c9b8a7f6e5d4c3b2a1"]}',
      "application/json",
    );
    expect(served.has("scope", "suppress_marketing_only_please")).toBe(false);
    expect(served.has("scope", "share_with_partner_brands_ok")).toBe(false);
    expect(served.has("records", "a1b2c3d4e5f6a7b8c9d0e1f2")).toBe(false);
    expect(served.has("ticket", "k3J9xQ2mLw8TzP4vRb7YcN1d")).toBe(true);
  });

  it("reads the keys of a json answer as served values", () => {
    const served = new ServedValues();
    served.record('{"data":{"token":"abcdefghijklmnopqrstuvwx"}}', "application/json");
    expect(served.has("token", "abcdefghijklmnopqrstuvwx")).toBe(true);
    expect(served.has("token", "other")).toBe(false);
  });

  it("lists the query by name, and the headers and cookies that carry a value", () => {
    const { request } = canonicalize({
      event: paused(
        {
          url: "https://broker.test/p?name=Jordan&z=1",
          method: "GET",
          headers: { "x-who": "jordan.example@example.com" },
        },
        { resourceType: "Fetch" },
      ),
      body: { bytes: null, present: false, unreadable: false },
      cookies: [{ name: "em", value: encodeURIComponent("jordan.example@example.com") }],
      target: { type: "page", frameOrigin: "https://broker.test", topLevel: true },
      party: "target",
      detector,
      mask,
      served: new ServedValues(),
    });
    expect(request.query.map((value) => [value.path, value.class])).toEqual([
      ["name", "profile"],
      ["z", "literal"],
    ]);
    expect(request.headers.map((value) => value.path)).toEqual(["x-who", "cookie:em"]);
    expect(request.bodyKind).toBe("none");
  });

  it("does not hold a request for the Referer of a request to the target, but records what it held", () => {
    const withReferer = (party: "target" | "third") =>
      canonicalize({
        event: paused({
          method: "GET",
          headers: { referer: "https://broker.test/page?e=jordan.example%40example.com" },
        }),
        body: { bytes: null, present: false, unreadable: false },
        cookies: [],
        target: { type: "page", frameOrigin: "https://broker.test", topLevel: true },
        party,
        detector,
        mask,
        served: new ServedValues(),
      });
    expect(withReferer("target").scan.contact).toBe(false);
    expect(withReferer("target").refererCarries).toEqual(["email", "first_name"]);
    expect(withReferer("third").scan.contact).toBe(true);
    expect(withReferer("third").refererCarries).toEqual([]);
  });

  describe("the Referer a request to the target leaves with", () => {
    it("is cut to scheme, host and port with a trailing slash", () => {
      expect(
        headersWithShortReferer({
          Accept: "*/*",
          Referer: "https://broker.test:8443/page?e=jordan#top",
        }),
      ).toEqual([
        { name: "Accept", value: "*/*" },
        { name: "Referer", value: "https://broker.test:8443/" },
      ]);
    });

    it("needs no change when it already is only the site address, or is absent", () => {
      expect(headersWithShortReferer({ referer: "https://broker.test/" })).toBeNull();
      expect(headersWithShortReferer({ accept: "*/*" })).toBeNull();
      expect(headersWithShortReferer(undefined)).toBeNull();
    });

    it("is dropped when it names no web address", () => {
      expect(headersWithShortReferer({ referer: "about:blank", accept: "*/*" })).toEqual([
        { name: "accept", value: "*/*" },
      ]);
    });
  });

  it("hashes the raw body for the digest, and says how large it was", () => {
    const { request } = canonical(paused(), bodyOf("abc"));
    expect(request.bodyDigest).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(request.bodyBytes).toBe(3);
  });
});

describe("readBody", () => {
  const never = async () => {
    throw new Error("not asked");
  };

  it("reads a body the browser handed over whole", async () => {
    const body = await readBody(paused({ postData: "a=1" }), never);
    expect(body).toMatchObject({ present: true, unreadable: false });
    expect(body.bytes?.toString()).toBe("a=1");
  });

  it("reads the bytes of a body that is not text", async () => {
    const body = await readBody(
      paused({ postDataEntries: [{ bytes: Buffer.from([1, 2, 3]).toString("base64") }] }),
      never,
    );
    expect([...(body.bytes ?? [])]).toEqual([1, 2, 3]);
  });

  it("asks for a body the browser left out, and gives up on one it cannot get", async () => {
    const asked = await readBody(paused({ hasPostData: true }), async () => ({
      postData: "late=1",
    }));
    expect(asked.bytes?.toString()).toBe("late=1");
    expect(await readBody(paused({ hasPostData: true }), never)).toMatchObject({
      present: true,
      unreadable: true,
    });
  });

  it("calls a stream, a file or a body over the limit unreadable", async () => {
    expect(await readBody(paused({ postDataEntries: [{}] }), never)).toMatchObject({
      unreadable: true,
    });
    const huge = "x".repeat(2 * 1024 * 1024 + 1);
    expect(await readBody(paused({ postData: huge }), never)).toMatchObject({ unreadable: true });
  });

  it("finds no body on a request that has none", async () => {
    expect(await readBody(paused({ method: "GET" }), never)).toMatchObject({ present: false });
  });
});

describe("canonicalize scans everything just past each limit it shows", () => {
  const EMAIL = "jordan.example@example.com";
  const target = { type: "page", frameOrigin: "https://broker.test", topLevel: true } as const;
  const none: BodyRead = { bytes: null, present: false, unreadable: false };
  const run = (
    request: PausedRequest,
    body: BodyRead = none,
    cookies: { name: string; value: string }[] | null = [],
    party: "target" | "third" = "target",
  ) =>
    canonicalize({
      event: request,
      body,
      cookies,
      target,
      party,
      detector,
      mask,
      served: new ServedValues(),
    });
  const get = (url: string, headers: Record<string, string> = {}) =>
    paused({ url, method: "GET", headers });
  const decoys = (count: number) => Array.from({ length: count }, (_, index) => `d${index}`);

  it("finds an email in the 101st cookie that carries something", () => {
    const cookies = [
      ...decoys(100).map((name) => ({ name, value: "Jordan" })),
      { name: "last", value: EMAIL },
    ];
    const result = run(get("https://broker.test/pixel.gif"), none, cookies);
    expect(result.scan.contact).toBe(true);
    expect(result.request.carries).toContain("email");
    expect(result.request.headers).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it("finds an email in the 101st header that carries something", () => {
    const headers = Object.fromEntries([
      ...decoys(100).map((name) => [`x-${name}`, "Jordan"]),
      ["x-last", EMAIL],
    ]);
    const result = run(get("https://broker.test/pixel.gif", headers));
    expect(result.scan.contact).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("finds an email in the first cookie past 100 that carries something, with plain ones between", () => {
    const cookies = [
      ...decoys(100).map((name) => ({ name, value: "Jordan" })),
      ...decoys(50).map((name) => ({ name: `p${name}`, value: "1" })),
      { name: "last", value: EMAIL },
    ];
    expect(run(get("https://broker.test/p"), none, cookies).scan.contact).toBe(true);
  });

  it("finds an email in the 401st query pair", () => {
    const pairs = [...decoys(400).map((name) => `${name}=1`), `last=${EMAIL}`];
    const result = run(get(`https://broker.test/s?${pairs.join("&")}`));
    expect(result.scan.contact).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("finds an email in the 401st form field and the 801st JSON leaf", () => {
    const form = run(
      paused({ headers: { "content-type": "application/x-www-form-urlencoded" } }),
      bodyOf([...decoys(400).map((name) => `${name}=1`), `last=${EMAIL}`].join("&")),
    );
    expect(form.scan.contact).toBe(true);
    expect(form.truncated).toBe(true);
    const leaves = Object.fromEntries([...decoys(800).map((name) => [name, 1]), ["last", EMAIL]]);
    const json = run(
      paused({ headers: { "content-type": "application/json" } }),
      bodyOf(JSON.stringify(leaves)),
    );
    expect(json.scan.contact).toBe(true);
    expect(json.truncated).toBe(true);
  });

  it("finds an email after the 4000th character of a value", () => {
    const result = run(
      paused({ headers: { "content-type": "application/x-www-form-urlencoded" } }),
      bodyOf(`note=${"a".repeat(4000)}${EMAIL}`),
    );
    expect(result.scan.contact).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("finds an email in a path longer than is shown", () => {
    const result = run(get(`https://broker.test/${"a".repeat(4001)}/${EMAIL}`));
    expect(result.scan.contact).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("is unreadable when the cookies could not be read", () => {
    expect(run(get("https://broker.test/p"), none, null).unreadable).toBe(true);
    expect(run(get("https://broker.test/p"), none, []).unreadable).toBe(false);
  });

  it("is unreadable when a body is larger than is read", () => {
    expect(
      run(paused(), { bytes: Buffer.alloc(1), present: true, unreadable: true }).unreadable,
    ).toBe(true);
  });

  describe("when a query value, a header or a cookie is packed past what is unpacked", () => {
    const layers = (count: number) =>
      Array.from({ length: count }).reduce<Buffer>((bytes) => gzipSync(bytes), Buffer.from(EMAIL));
    const packed = layers(4).toString("base64url");

    it("is unreadable for a query value", () => {
      expect(run(get(`https://broker.test/s?x=${packed}`)).unreadable).toBe(true);
    });

    it("is unreadable for a header value", () => {
      expect(run(get("https://broker.test/s", { "x-token": packed })).unreadable).toBe(true);
    });

    it("is unreadable for a cookie value", () => {
      expect(
        run(get("https://broker.test/s"), none, [{ name: "t", value: packed }]).unreadable,
      ).toBe(true);
    });

    it("is unreadable for a body field", () => {
      expect(
        run(
          paused({ headers: { "content-type": "application/x-www-form-urlencoded" } }),
          bodyOf(`x=${packed}`),
        ).unreadable,
      ).toBe(true);
    });
  });
});

describe("canonicalize keeps the record inside what the server accepts", () => {
  const long = "a".repeat(2500);

  it("clips a request path to the schema and says it was cut", () => {
    const result = canonical(paused({ url: `https://broker.test/${long}`, method: "GET" }), {
      bytes: null,
      present: false,
      unreadable: false,
    });
    expect(result.request.path).toHaveLength(2000);
    expect(result.truncated).toBe(true);
    expect(OutgoingRequest.safeParse(result.request).success).toBe(true);
  });

  it("clips the path of every value, in a body, a query and a cookie", () => {
    const body = canonical(
      paused({
        url: `https://broker.test/api?${"q".repeat(500)}=1`,
        headers: { "content-type": "application/json" },
      }),
      bodyOf(JSON.stringify({ [`k${"k".repeat(500)}`]: "v" })),
    );
    expect(body.truncated).toBe(true);
    expect(OutgoingRequest.safeParse(body.request).success).toBe(true);
    const cookie = canonicalize({
      event: paused({ method: "GET" }),
      body: { bytes: null, present: false, unreadable: false },
      cookies: [{ name: "c".repeat(500), value: FIELDS.email }],
      target: { type: "page", frameOrigin: "https://broker.test", topLevel: true },
      party: "target",
      detector,
      mask,
      served: new ServedValues(),
    });
    expect(OutgoingRequest.safeParse(cookie.request).success).toBe(true);
  });
});

describe("canonicalize reads the parts the page chooses", () => {
  const none = { bytes: null, present: false, unreadable: false };

  it("flags a username or password in the address and scans both", () => {
    const plain = canonical(paused({ url: "https://broker.test/x", method: "GET" }), none);
    expect(plain.urlCredentials).toBe(false);
    const user = canonical(
      paused({
        url: `https://${encodeURIComponent(FIELDS.email)}:pw@broker.test/x`,
        method: "GET",
      }),
      none,
    );
    expect(user.urlCredentials).toBe(true);
    expect(user.scan.contact).toBe(true);
    expect(JSON.stringify(user.request)).not.toContain(FIELDS.email);
  });

  it("scans a method that is not a standard one", () => {
    const result = canonical(paused({ method: "jordan.example@example.com" }), none);
    expect(result.scan.contact).toBe(true);
    expect(result.request.method).toBe("{{email}}");
    const long = canonical(paused({ method: "LONGMETHODNAME".repeat(3) }), none);
    expect(long.request.method).toHaveLength(16);
    expect(long.truncated).toBe(true);
  });

  it("shows a file part with a digest of its bytes, so a different file of the same size differs", () => {
    const part = (content: string) => {
      const boundary = "xyz";
      const text = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="id"; filename="id.png"',
        "",
        content,
        `--${boundary}--`,
        "",
      ].join("\r\n");
      return canonical(
        paused({ headers: { "content-type": `multipart/form-data; boundary=${boundary}` } }),
        bodyOf(text),
      ).request.body[0]?.value;
    };
    const digest = createHash("sha256").update("12345").digest("hex");
    expect(part("12345")).toBe(`[file id.png, 5 bytes, sha256 ${digest}]`);
    expect(part("12346")).not.toBe(part("12345"));
  });

  describe("a file part", () => {
    const upload = (content: Buffer) => {
      const boundary = "xyz";
      const text = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="doc"; filename="doc.bin"\r\n\r\n`,
          "latin1",
        ),
        content,
        Buffer.from(`\r\n--${boundary}--\r\n`, "latin1"),
      ]);
      return canonical(
        paused({ headers: { "content-type": `multipart/form-data; boundary=${boundary}` } }),
        bodyOf(text),
      );
    };

    it("is unpacked, so an email inside a gzipped Blob is found", () => {
      const result = upload(gzipSync(Buffer.from("jordan.example@example.com")));
      expect(result.scan.fields).toContain("email");
      expect(result.scan.contact).toBe(true);
      expect(result.unreadable).toBe(false);
    });

    it("is unreadable when its bytes are not text, so it is refused after touch", () => {
      const result = upload(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]),
      );
      expect(result.unreadable).toBe(true);
      expect(result.scan.overflow).toBe(true);
    });

    it("is unreadable when its compression is damaged", () => {
      const packed = gzipSync(Buffer.from("jordan.example@example.com"));
      expect(upload(packed.subarray(0, packed.length - 6)).unreadable).toBe(true);
    });

    it("stays readable when it is plain text", () => {
      expect(upload(Buffer.from("hello there")).unreadable).toBe(false);
    });
  });
});
