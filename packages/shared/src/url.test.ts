import { describe, expect, it } from "vitest";
import { Broker } from "./broker.js";
import { MessageSummary } from "./mail.js";
import { RequestRecord } from "./requests.js";
import { isOnDomain, normalizeRecordUrl, WebUrl } from "./url.js";

describe("WebUrl", () => {
  it("accepts http and https", () => {
    expect(WebUrl.safeParse("https://example.com/a?b=1").success).toBe(true);
    expect(WebUrl.safeParse("http://example.com").success).toBe(true);
  });

  it("rejects every scheme that is not a web page", () => {
    for (const url of [
      "javascript:alert(1)//x.com",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://example.com",
      "mailto:privacy@example.com",
      "//example.com",
      "example.com",
    ]) {
      expect(WebUrl.safeParse(url).success, url).toBe(false);
    }
  });
});

describe("URL fields that are rendered or opened", () => {
  const evil = "javascript:alert(1)//x.com";

  it("refuse a non-web scheme on a broker", () => {
    const broker = {
      id: "x",
      name: "X",
      category: "marketing",
      website: "https://x.example",
      domain: "x.example",
      privacyEmail: null,
      optOutUrl: null,
      privacyRightsUrl: null,
      searchUrl: null,
      contactMethod: "unknown",
      region: "us",
      requiresId: false,
      requirements: [],
      priority: "normal",
      regulatedBy: [],
      collectsMinors: null,
      collectsGeolocation: null,
      collectsReproductiveHealth: null,
      metrics: null,
      notes: null,
      sources: [{ source: "eraser", license: "MIT" }],
    };
    expect(Broker.safeParse(broker).success).toBe(true);
    for (const field of ["website", "optOutUrl", "privacyRightsUrl", "searchUrl"]) {
      expect(Broker.safeParse({ ...broker, [field]: evil }).success, field).toBe(false);
    }
  });

  it("refuse a non-web link taken from incoming mail", () => {
    const message = {
      id: "m",
      mailboxId: "b",
      requestId: null,
      fromAddress: "a@example.com",
      subject: "s",
      receivedAt: "2026-10-07T00:00:00.000Z",
      classification: "unknown",
      confidence: 0,
      rationale: null,
      links: ["https://example.com/confirm"],
      requestedFields: [],
      snippet: null,
      reviewed: false,
    };
    expect(MessageSummary.safeParse(message).success).toBe(true);
    expect(MessageSummary.safeParse({ ...message, links: [evil] }).success).toBe(false);
  });

  it("refuse a non-web record url on a request", () => {
    expect(RequestRecord.shape.recordUrl.safeParse(evil).success).toBe(false);
    expect(RequestRecord.shape.recordUrl.safeParse(null).success).toBe(true);
  });
});

describe("isOnDomain", () => {
  it("matches the domain, its www form, and its subdomains", () => {
    expect(isOnDomain("https://spokeo.com/a", "spokeo.com")).toBe(true);
    expect(isOnDomain("https://www.spokeo.com/a", "spokeo.com")).toBe(true);
    expect(isOnDomain("https://optout.spokeo.com/a", "spokeo.com")).toBe(true);
    expect(isOnDomain("https://www.spokeo.com/a", "www.spokeo.com")).toBe(true);
  });

  it("does not match a lookalike or a different scheme", () => {
    expect(isOnDomain("https://evilspokeo.com/", "spokeo.com")).toBe(false);
    expect(isOnDomain("https://spokeo.com.evil.example/", "spokeo.com")).toBe(false);
    expect(isOnDomain("https://evil.example/spokeo.com", "spokeo.com")).toBe(false);
    expect(isOnDomain("https://user@evil.example/", "spokeo.com")).toBe(false);
    expect(isOnDomain("javascript:alert(1)", "spokeo.com")).toBe(false);
    expect(isOnDomain("not a url", "spokeo.com")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isOnDomain("https://WWW.Spokeo.COM/A", "Spokeo.com")).toBe(true);
  });
});

describe("normalizeRecordUrl", () => {
  it("gives one spelling to every URL that names the same record", () => {
    const spellings = [
      "https://www.spokeo.com/Jordan-Example/TX/Austin/p123",
      "http://spokeo.com/Jordan-Example/TX/Austin/p123/",
      "https://SPOKEO.com/Jordan-Example/TX/Austin/p123#top",
      "  https://spokeo.com:443/Jordan-Example/TX/Austin/p123  ",
    ];
    const keys = new Set(spellings.map(normalizeRecordUrl));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("spokeo.com/Jordan-Example/TX/Austin/p123");
  });

  it("keeps what distinguishes two records", () => {
    expect(normalizeRecordUrl("https://x.example/p?id=1")).not.toBe(
      normalizeRecordUrl("https://x.example/p?id=2"),
    );
    expect(normalizeRecordUrl("https://x.example/a")).not.toBe(
      normalizeRecordUrl("https://x.example/A"),
    );
    expect(normalizeRecordUrl("https://x.example:8443/a")).not.toBe(
      normalizeRecordUrl("https://x.example/a"),
    );
  });

  it("returns null for anything that is not a web page", () => {
    expect(normalizeRecordUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeRecordUrl("nope")).toBeNull();
  });
});
