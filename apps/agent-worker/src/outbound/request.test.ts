import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createMask } from "../mask.js";
import { ValueDetector } from "./detector.js";
import {
  type BodyRead,
  canonicalize,
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

  it("does not read the Referer of a request to the target, which only repeats an address it admitted", () => {
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
    expect(withReferer("third").scan.contact).toBe(true);
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
