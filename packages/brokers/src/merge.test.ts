import type { Broker } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { mergeBrokers } from "./merge.js";

function broker(overrides: Partial<Broker> & Pick<Broker, "id" | "domain">): Broker {
  return {
    name: overrides.id,
    category: "marketing",
    website: `https://${overrides.domain}`,
    privacyEmail: null,
    optOutUrl: null,
    privacyRightsUrl: null,
    contactMethod: "unknown",
    region: "us",
    requiresId: false,
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
        { source: "ca-registry-2025", license: "public-record", upstreamId: "Spokeo, Inc." },
      ],
    });
    const merged = mergeBrokers([eraser], [registry]);
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
    expect(merged[0]?.sources.map((s) => s.source)).toEqual(["eraser", "ca-registry-2025"]);
  });

  it("lets a registry-only record keep its category", () => {
    const registry = broker({ id: "acme", domain: "acme.example", category: "registered-broker" });
    expect(mergeBrokers([], [registry])[0]?.category).toBe("registered-broker");
  });

  it("disambiguates colliding ids across different domains", () => {
    const a = broker({ id: "same", domain: "a.example" });
    const b = broker({ id: "same", domain: "b.example" });
    const ids = mergeBrokers([a, b]).map((x) => x.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain("same");
  });
});
