import { describe, expect, it } from "vitest";
import { Company, needsRecord, TargetCategory, TargetSummary } from "./targets.js";

const company = {
  id: "example-co",
  name: "Example Co",
  domain: "example.com",
  category: "retail",
  privacyEmail: "privacy@example.com",
  optOutUrl: null,
  privacyRightsUrl: "https://example.com/privacy",
  contactMethod: "email",
  notes: null,
  sources: [{ source: "kickrocks-companies", license: "PolyForm-Noncommercial-1.0.0" }],
  verifiedAt: "2026-10-01",
};

describe("Company", () => {
  it("accepts a complete record", () => {
    expect(Company.safeParse(company).success).toBe(true);
  });

  it("requires a verification date and at least one source", () => {
    expect(Company.safeParse({ ...company, verifiedAt: null }).success).toBe(false);
    expect(Company.safeParse({ ...company, sources: [] }).success).toBe(false);
  });

  it("rejects a broker category", () => {
    expect(Company.safeParse({ ...company, category: "people-search" }).success).toBe(false);
  });
});

describe("TargetCategory", () => {
  it("covers both broker and company categories", () => {
    expect(TargetCategory.options).toContain("people-search");
    expect(TargetCategory.options).toContain("retail");
    expect(new Set(TargetCategory.options).size).toBe(TargetCategory.options.length);
  });
});

describe("needsRecord", () => {
  it("is true for people-search and background-check sites that need a record url", () => {
    expect(needsRecord({ category: "people-search", requirements: ["record_url"] })).toBe(true);
    expect(
      needsRecord({ category: "background-check", requirements: ["captcha", "record_url"] }),
    ).toBe(true);
  });

  it("is false when the form does not need a record url", () => {
    expect(needsRecord({ category: "people-search", requirements: ["captcha"] })).toBe(false);
  });

  it("is false for other categories even if they list a record url", () => {
    expect(needsRecord({ category: "marketing", requirements: ["record_url"] })).toBe(false);
    expect(needsRecord({ category: "retail", requirements: [] })).toBe(false);
  });
});

describe("TargetSummary", () => {
  it("round-trips through the schema", () => {
    const summary = {
      id: "spokeo",
      kind: "broker",
      name: "Spokeo",
      category: "people-search",
      domain: "spokeo.com",
      website: "https://www.spokeo.com/",
      contactMethod: "form",
      requiresId: false,
      requirements: ["record_url"],
      priority: "crucial",
      needsRecord: true,
    };
    expect(TargetSummary.parse(summary)).toEqual(summary);
  });
});
