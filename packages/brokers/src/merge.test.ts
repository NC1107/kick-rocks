import type { Broker } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { mergeBrokers, withholdEmailEraserRefused } from "./merge.js";

function broker(overrides: Partial<Broker> & Pick<Broker, "id" | "domain">): Broker {
  return {
    name: overrides.id,
    category: "marketing",
    website: `https://${overrides.domain}`,
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
    sources: [{ source: "kickrocks", license: "PolyForm-Noncommercial-1.0.0" }],
    ...overrides,
  };
}

describe("mergeBrokers", () => {
  it("merges records that share a domain and keeps the specific category", () => {
    const eraser = broker({
      id: "spokeo",
      domain: "spokeo.com",
      category: "people-search",
      optOutUrl: "https://www.spokeo.com/optout",
      sources: [{ source: "eraser", license: "MIT", upstreamId: "spokeo" }],
    });
    const registry = broker({
      id: "spokeo-inc",
      domain: "spokeo.com",
      category: "registered-broker",
      privacyEmail: "privacy@spokeo.com",
      privacyRightsUrl: "https://www.spokeo.com/privacy",
      regulatedBy: ["fcra"],
      sources: [
        { source: "ca-registry-2026", license: "public-record", upstreamId: "Spokeo, Inc." },
      ],
    });
    const merged = mergeBrokers([[eraser], [registry]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "spokeo",
      category: "people-search",
      privacyEmail: "privacy@spokeo.com",
      optOutUrl: "https://www.spokeo.com/optout",
      privacyRightsUrl: "https://www.spokeo.com/privacy",
      contactMethod: "both",
      regulatedBy: ["fcra"],
    });
    expect(merged[0]?.sources.map((s) => s.source)).toEqual(["eraser", "ca-registry-2026"]);
  });

  it("keeps the search url, unions requirements, and takes the higher priority", () => {
    const curated = broker({
      id: "spokeo",
      domain: "spokeo.com",
      searchUrl: "https://www.spokeo.com/search",
      requirements: ["record_url", "captcha"],
      priority: "high",
    });
    const registry = broker({
      id: "spokeo-inc",
      domain: "spokeo.com",
      requirements: ["captcha", "email_confirmation"],
      priority: "crucial",
    });
    expect(mergeBrokers([[curated], [registry]])[0]).toMatchObject({
      searchUrl: "https://www.spokeo.com/search",
      requirements: ["record_url", "captcha", "email_confirmation"],
      priority: "crucial",
    });
  });

  it("lets a registry-only record keep its category", () => {
    const registry = broker({ id: "acme", domain: "acme.example", category: "registered-broker" });
    expect(mergeBrokers([[], [registry]])[0]?.category).toBe("registered-broker");
  });

  it("disambiguates colliding ids across different domains", () => {
    const a = broker({ id: "same", domain: "a.example" });
    const b = broker({ id: "same", domain: "b.example" });
    const ids = mergeBrokers([[a, b]]).map((x) => x.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain("same");
  });

  describe("pinned ids", () => {
    const pinnedIds = { "spokeo.com": "spokeo" };

    it("keeps the pinned id whichever list a record comes from first", () => {
      const curated = broker({ id: "spokeo-com-curated", domain: "spokeo.com" });
      const eraser = broker({ id: "spokeo", domain: "spokeo.com" });
      expect(mergeBrokers([[curated], [eraser]], { pinnedIds })[0]?.id).toBe("spokeo");
      expect(mergeBrokers([[eraser], [curated]], { pinnedIds })[0]?.id).toBe("spokeo");
    });

    it("does not let another domain take an id that is pinned to a different one", () => {
      const squatter = broker({ id: "spokeo", domain: "spokeo.example" });
      const real = broker({ id: "other", domain: "spokeo.com" });
      const merged = mergeBrokers([[squatter, real]], { pinnedIds });
      expect(merged.find((b) => b.domain === "spokeo.com")?.id).toBe("spokeo");
      expect(merged.find((b) => b.domain === "spokeo.example")?.id).toBe("spokeo-spokeo-example");
    });

    it("leaves records without a pin on their own id", () => {
      const fresh = broker({ id: "fresh", domain: "fresh.example" });
      expect(mergeBrokers([[fresh]], { pinnedIds })[0]?.id).toBe("fresh");
    });
  });
});

describe("withholdEmailEraserRefused", () => {
  const eraser = (overrides: Partial<Broker> = {}) =>
    broker({
      id: "x",
      domain: "x.test",
      optOutUrl: "https://x.test/form",
      notes: "Reply says email is not processed.",
      contactMethod: "form",
      sources: [{ source: "eraser", license: "MIT", upstreamId: "x" }],
      ...overrides,
    });
  const registry = () =>
    broker({
      id: "x-inc",
      domain: "x.test",
      privacyEmail: "privacy@x.test",
      contactMethod: "email",
      sources: [{ source: "ca-registry-2026", license: "public-record" }],
    });

  it("keeps the registry address out of a record Eraser lists with no email, a form and a note", () => {
    const merged = mergeBrokers(withholdEmailEraserRefused([[eraser()], [registry()]]));
    expect(merged[0]?.privacyEmail).toBeNull();
    expect(merged[0]?.contactMethod).toBe("form");
  });

  it("lets a correction that gives the Eraser record an email stand", () => {
    const corrected = eraser({ privacyEmail: "legal@x.test", contactMethod: "both" });
    const merged = mergeBrokers(withholdEmailEraserRefused([[corrected], [registry()]]));
    expect(merged[0]?.privacyEmail).toBe("legal@x.test");
  });

  it.each([
    ["no note", { notes: null }],
    ["no form", { optOutUrl: null }],
  ])("backfills the registry address when Eraser has %s", (_name, overrides) => {
    const merged = mergeBrokers(withholdEmailEraserRefused([[eraser(overrides)], [registry()]]));
    expect(merged[0]?.privacyEmail).toBe("privacy@x.test");
  });
});
