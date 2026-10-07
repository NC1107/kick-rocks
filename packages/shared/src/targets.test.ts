import { describe, expect, it } from "vitest";
import {
  Company,
  needsRecord,
  RECORD_NOT_NEEDED,
  replyDomainsOf,
  TargetCategory,
  TargetSummary,
} from "./targets.js";

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
  it("is true for people-search and background-check sites whatever the dataset lists", () => {
    expect(needsRecord({ id: "spokeo", category: "people-search" })).toBe(true);
    expect(needsRecord({ id: "checkr", category: "background-check" })).toBe(true);
  });

  it("is false for every other category", () => {
    expect(needsRecord({ id: "acme", category: "marketing" })).toBe(false);
    expect(needsRecord({ id: "shop", category: "retail" })).toBe(false);
    expect(needsRecord({ id: "bureau", category: "registered-broker" })).toBe(false);
  });

  it("honors an explicit exception, which is empty until someone has read the opt-out page", () => {
    expect(RECORD_NOT_NEEDED.size).toBe(0);
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
      optOutUrl: "https://www.spokeo.com/optout",
      searchUrl: null,
      contactMethod: "form",
      requiresId: false,
      requirements: ["record_url"],
      priority: "crucial",
      needsRecord: true,
      californiaRegistered: false,
      retired: false,
    };
    expect(TargetSummary.parse(summary)).toEqual(summary);
  });
});

describe("replyDomainsOf", () => {
  const base = {
    domain: "acme.test",
    privacyEmail: null,
    optOutUrl: null,
    privacyRightsUrl: null,
  };

  it("is the target's own domain when nothing else is published", () => {
    expect(replyDomainsOf(base)).toEqual(["acme.test"]);
  });

  it("adds the hosts of the privacy email, opt-out page, and rights page", () => {
    expect(
      replyDomainsOf({
        ...base,
        privacyEmail: "Privacy@Vendor.test",
        optOutUrl: "https://optout.parent.test/form",
        privacyRightsUrl: "https://acme.test/rights",
      }),
    ).toEqual(["acme.test", "vendor.test", "optout.parent.test"]);
  });

  it("adds the dataset's explicit list without duplicates", () => {
    expect(
      replyDomainsOf({
        ...base,
        privacyEmail: "p@acme.test",
        replyDomains: ["Sister.test", "acme.test"],
      }),
    ).toEqual(["acme.test", "sister.test"]);
  });
});

describe("Company replyDomains", () => {
  it("accepts a list of hostnames and rejects anything else", () => {
    expect(Company.safeParse({ ...company, replyDomains: ["mail.vendor.test"] }).success).toBe(
      true,
    );
    expect(Company.safeParse({ ...company, replyDomains: ["https://vendor.test"] }).success).toBe(
      false,
    );
  });
});
