import { createHash, randomBytes } from "node:crypto";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ValueDetector } from "./detector.js";

const FIELDS = {
  first_name: "Jordan",
  last_name: "Example",
  full_name: "Jordan Example",
  email: "Jordan.Example@example.com",
  phone: "+15125550123",
  city: "Austin",
  state: "TX",
  zip: "78701",
  birth_year: "1990",
  date_of_birth: "1990-04-05",
  street: "42 Oak Lane",
};
const detector = new ValueDetector(FIELDS, ["Quentin", "Mary Q"]);

const email = FIELDS.email;
const hash = (algorithm: string, form: string) => createHash(algorithm).update(form).digest();

function contactIn(...pieces: Parameters<ValueDetector["scan"]>[0]): boolean {
  return detector.scan(pieces).contact;
}

describe("ValueDetector", () => {
  describe("a contact value in the spellings a page may use", () => {
    it.each([
      ["as typed", email],
      ["in another case", email.toUpperCase()],
      ["percent encoded", encodeURIComponent(email)],
      ["double percent encoded", encodeURIComponent(encodeURIComponent(email))],
      ["inside a url", `https://x.test/p?e=${encodeURIComponent(email)}&z=1`],
      ["as a json string", JSON.stringify({ user: { contact: [email] } })],
      ["with \\u escapes", `{"e":"${email.replace("@", "\\u0040").replace(/\//g, "\\/")}"}`],
      ["as an html entity", email.replace("@", "&#64;")],
      ["as hex", Buffer.from(email).toString("hex")],
      ["as base64", Buffer.from(email).toString("base64")],
      ["as base64url", Buffer.from(email).toString("base64url")],
      ["as base64 inside other text", `token=zzzzz${Buffer.from(email).toString("base64")}&x=1`],
      ["as base64 at another alignment", Buffer.from(`xx${email}`).toString("base64")],
      ["as base64 at a third alignment", Buffer.from(`xxxx${email}`).toString("base64")],
      [
        "as base64 of base64",
        Buffer.from(Buffer.from(email).toString("base64")).toString("base64"),
      ],
      [
        "as a json value that holds base64",
        JSON.stringify({ d: Buffer.from(email).toString("base64") }),
      ],
    ])("finds it %s", (_, text) => {
      expect(contactIn(text)).toBe(true);
    });

    it("finds it in a body packed with gzip, deflate or brotli", () => {
      const body = JSON.stringify({ email });
      expect(contactIn({ data: gzipSync(Buffer.from(body)), contentEncoding: "gzip" })).toBe(true);
      expect(contactIn({ data: deflateSync(Buffer.from(body)), contentEncoding: "deflate" })).toBe(
        true,
      );
      expect(
        contactIn({ data: brotliCompressSync(Buffer.from(body)), contentEncoding: "br" }),
      ).toBe(true);
    });

    it("finds it in a packed body that says nothing about the packing", () => {
      expect(contactIn({ data: gzipSync(Buffer.from(email)) })).toBe(true);
      expect(contactIn({ data: deflateSync(Buffer.from(email)) })).toBe(true);
    });

    it("finds it as base64 of a gzip", () => {
      expect(contactIn(gzipSync(Buffer.from(email)).toString("base64"))).toBe(true);
    });

    it("reports a body that claims a packing it does not have as one it could not read", () => {
      const scan = detector.scan([{ data: Buffer.from("plain"), contentEncoding: "gzip" }]);
      expect(scan.overflow).toBe(true);
    });
  });

  describe("the hashes ad pixels send", () => {
    it.each(["md5", "sha1", "sha256"])("finds the %s of the lowercased email", (algorithm) => {
      const digest = hash(algorithm, email.toLowerCase());
      expect(contactIn(`em=${digest.toString("hex")}`)).toBe(true);
      expect(contactIn(`em=${digest.toString("base64")}`)).toBe(true);
      expect(contactIn(`em=${digest.toString("base64url")}`)).toBe(true);
    });

    it("finds the sha256 of the phone in E.164 digits, with and without the plus", () => {
      expect(contactIn(hash("sha256", "+15125550123").toString("hex"))).toBe(true);
      expect(contactIn(hash("sha256", "15125550123").toString("hex"))).toBe(true);
    });

    it("finds the hash of the date of birth without separators", () => {
      expect(contactIn(hash("sha256", "19900405").toString("hex"))).toBe(true);
    });

    it("finds a hash of a lookup value, which is not a contact value", () => {
      const scan = detector.scan([hash("sha256", "austin").toString("hex")]);
      expect(scan).toMatchObject({ contact: false, lookup: true, fields: ["city"] });
    });
  });

  describe("other spellings", () => {
    it.each([
      ["a phone in a mask", "(512) 555-0123"],
      ["a phone in digits", "5125550123"],
      ["a date of birth in US form", "04/05/1990"],
      ["a date of birth without separators", "19900405"],
      ["a street", "42 oak lane"],
      ["a value no field names", "quentin"],
      ["another value no field names", "mary q"],
      ["the first typed characters of the email", "jordan.example@e"],
    ])("finds %s", (_, text) => {
      expect(contactIn(`x=${text}`)).toBe(true);
    });

    it("tells a lookup value from a contact value", () => {
      expect(detector.scan(["name=Jordan+Example&city=Austin&state=TX&yob=1990"])).toMatchObject({
        contact: false,
        lookup: true,
      });
      expect(detector.scan(["q=Jordan%20Example"]).fields).toContain("full_name");
      expect(detector.scan(["q=Example,Jordan"]).lookup).toBe(true);
    });

    it("finds a name joined in the ways a page joins one", () => {
      for (const joined of [
        "Jordan+Example",
        "jordan-example",
        "example_jordan",
        "Jordan%20Example",
      ]) {
        expect(detector.scan([`s=${joined}`]).lookup, joined).toBe(true);
      }
    });
  });

  describe("short and numeric values", () => {
    it("match as a whole value or a delimited token only", () => {
      expect(detector.scan(["state=TX"]).fields).toContain("state");
      expect(detector.scan(['{"state":"TX"}']).fields).toContain("state");
      expect(detector.scan(["tx"]).fields).toContain("state");
      expect(detector.scan(["a/austin-tx/b"]).fields).toContain("state");
      expect(detector.scan(["TXT"]).fields).not.toContain("state");
      expect(detector.scan(["context"]).fields).not.toContain("state");
      expect(detector.scan(["x-1990-y"]).fields).toContain("birth_year");
      expect(detector.scan(["219901"]).fields).not.toContain("birth_year");
      expect(detector.scan(["id=3787013"]).fields).not.toContain("zip");
      expect(detector.scan(["zip=78701"]).fields).toContain("zip");
    });
  });

  describe("a false-positive corpus", () => {
    it("does not take random tokens for a value", () => {
      for (let n = 0; n < 300; n++) {
        const token = randomBytes(24);
        for (const text of [
          token.toString("hex"),
          token.toString("base64"),
          token.toString("base64url"),
        ]) {
          expect(detector.scan([`csrf=${text}`]).fields, text).toEqual([]);
        }
      }
    });

    it("does not take everyday words for a value", () => {
      const detectorForIndiana = new ValueDetector({ state: "IN", first_name: "Oriel" });
      for (const text of ["OK", "ORDER", "sign-in", "text/html", "Accept: */*", "origin=ok"]) {
        const scan = detectorForIndiana.scan([text]);
        expect(scan.contact, text).toBe(false);
      }
      expect(new ValueDetector({ state: "OK" }).scan(["ORDERED=Y"]).fields).toEqual([]);
      expect(new ValueDetector({ state: "OR" }).scan(["for work"]).fields).toEqual([]);
    });

    it("does not take a page's own content type or ordinary json for a value", () => {
      expect(
        detector.scan(['{"type":"checkbox","id":18273,"ok":true}', "application/json"]).fields,
      ).toEqual([]);
    });
  });

  it("reports a request too large to read as one it could not read", () => {
    const huge = Buffer.alloc(9 * 1024 * 1024, 97);
    expect(detector.scan([{ data: gzipSync(huge), contentEncoding: "gzip" }]).overflow).toBe(true);
  });

  it("has nothing to find for a task that holds no value", () => {
    expect(new ValueDetector({}).isEmpty).toBe(true);
  });
});
