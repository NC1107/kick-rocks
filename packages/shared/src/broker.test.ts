import { describe, expect, it } from "vitest";
import { contactMethodFor, normalizeDomain, slugify } from "./broker.js";

describe("normalizeDomain", () => {
  it("strips scheme, www, path, and case", () => {
    expect(normalizeDomain("https://www.Spokeo.com/optout")).toBe("spokeo.com");
    expect(normalizeDomain("http://acxiom.com")).toBe("acxiom.com");
  });

  it("accepts bare hosts", () => {
    expect(normalizeDomain("whitepages.com")).toBe("whitepages.com");
    expect(normalizeDomain("  WWW.example.org  ")).toBe("example.org");
  });

  it("returns null for junk", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("not a url")).toBeNull();
  });
});

describe("contactMethodFor", () => {
  it("picks the method from what is available", () => {
    expect(contactMethodFor("privacy@x.com", "https://x.com/optout")).toBe("both");
    expect(contactMethodFor("privacy@x.com", null)).toBe("email");
    expect(contactMethodFor(null, "https://x.com/optout")).toBe("form");
    expect(contactMethodFor(null, null)).toBe("unknown");
  });
});

describe("slugify", () => {
  it("produces stable ids", () => {
    expect(slugify("Whitepages, Inc.")).toBe("whitepages-inc");
    expect(slugify("  Été Données  ")).toBe("ete-donnees");
  });
});
