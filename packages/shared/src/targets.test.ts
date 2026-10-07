import { describe, expect, it } from "vitest";
import {
  Company,
  needsRecord,
  RECORD_NOT_NEEDED,
  replyAddressesOf,
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

  it("adds the privacy email's domain", () => {
    expect(replyDomainsOf({ ...base, privacyEmail: "Privacy@Vendor.test" })).toEqual([
      "acme.test",
      "vendor.test",
    ]);
  });

  it("never adds the host of an opt-out or rights page", () => {
    expect(
      replyDomainsOf({
        ...base,
        optOutUrl: "https://docs.google.com/forms/d/e/1",
        privacyRightsUrl: "https://preferences.hubspot.com/x",
      } as never),
    ).toEqual(["acme.test"]);
  });

  it.each(["gmail.com", "Yahoo.com", "proton.me", "mail.onetrust.com", "forms.gle"])(
    "leaves out a privacy email on the shared host %s",
    (host) => {
      expect(replyDomainsOf({ ...base, privacyEmail: `privacy@${host}` })).toEqual(["acme.test"]);
    },
  );

  it("drops a shared host listed explicitly", () => {
    expect(replyDomainsOf({ ...base, replyDomains: ["gmail.com", "Sister.test"] })).toEqual([
      "acme.test",
      "sister.test",
    ]);
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

describe("replyAddressesOf", () => {
  it("is the exact lowercased address when the mailbox is on a public provider", () => {
    expect(replyAddressesOf({ privacyEmail: "Privacy@Gmail.com" })).toEqual(["privacy@gmail.com"]);
  });

  it("is empty for a mailbox on the target's own or a vendor domain, or none", () => {
    expect(replyAddressesOf({ privacyEmail: "privacy@acme.test" })).toEqual([]);
    expect(replyAddressesOf({ privacyEmail: null })).toEqual([]);
  });
});

describe("Company replyDomains", () => {
  it.each(["gmail.com", "mail.yahoo.co.uk", "google.com", "hubspotemail.net"])(
    "rejects the shared host %s",
    (host) => {
      expect(Company.safeParse({ ...company, replyDomains: [host] }).success).toBe(false);
    },
  );

  it("accepts a list of hostnames and rejects anything else", () => {
    expect(Company.safeParse({ ...company, replyDomains: ["mail.vendor.test"] }).success).toBe(
      true,
    );
    expect(Company.safeParse({ ...company, replyDomains: ["https://vendor.test"] }).success).toBe(
      false,
    );
  });
});
