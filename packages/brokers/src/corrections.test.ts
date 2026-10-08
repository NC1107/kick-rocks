import type { Broker } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  applyCorrections,
  dropExcluded,
  parseCorrections,
  parseExclusions,
} from "./corrections.js";

function broker(overrides: Partial<Broker>): Broker {
  return {
    id: "acme",
    name: "Acme",
    category: "marketing",
    website: "https://acme.example",
    domain: "acme.example",
    privacyEmail: "jane.doe@acme.example",
    optOutUrl: null,
    privacyRightsUrl: null,
    searchUrl: null,
    contactMethod: "email",
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
    ...overrides,
  };
}

const yaml = `corrections:
  - domain: acme.example
    set:
      email: privacy@acme.example
      privacy_rights_url: https://acme.example/ccpa
    source_urls: [https://acme.example/privacy]
    checked: 2026-10-07
    note: Eraser lists a named person.
`;

describe("applyCorrections", () => {
  it("replaces the fields in every list and recomputes the contact method", () => {
    const [first, second] = applyCorrections(
      [[broker({})], [broker({ privacyEmail: null, contactMethod: "unknown" })]],
      parseCorrections(yaml),
    );
    for (const record of [first?.[0], second?.[0]]) {
      expect(record).toMatchObject({
        privacyEmail: "privacy@acme.example",
        privacyRightsUrl: "https://acme.example/ccpa",
        contactMethod: "both",
        website: "https://acme.example",
      });
    }
  });

  it("can clear a field and move a record to another domain", () => {
    const corrections = parseCorrections(`corrections:
  - domain: old.example
    set: { domain: new.example, website: 'https://new.example', email: null }
    source_urls: [https://new.example/privacy]
    checked: 2026-10-07
    note: The site moved.
`);
    const [[moved]] = applyCorrections(
      [[broker({ domain: "old.example", website: "https://old.example" })]],
      corrections,
    );
    expect(moved).toMatchObject({
      domain: "new.example",
      website: "https://new.example",
      privacyEmail: null,
      contactMethod: "unknown",
    });
  });

  it("refuses a correction that matches no record", () => {
    expect(() =>
      applyCorrections([[broker({ domain: "other.example" })]], parseCorrections(yaml)),
    ).toThrow(/match no imported record: acme.example/);
  });

  it("refuses a correction that changes none of the records it matches", () => {
    expect(() =>
      applyCorrections(
        [
          [
            broker({
              privacyEmail: "privacy@acme.example",
              privacyRightsUrl: "https://acme.example/ccpa",
              contactMethod: "both",
            }),
          ],
        ],
        parseCorrections(yaml),
      ),
    ).toThrow(/change nothing.*acme.example/);
  });

  it("keeps a correction that still changes one of several lists", () => {
    const fixed = broker({
      privacyEmail: "privacy@acme.example",
      privacyRightsUrl: "https://acme.example/ccpa",
      contactMethod: "both",
    });
    expect(() => applyCorrections([[fixed], [broker({})]], parseCorrections(yaml))).not.toThrow();
  });
});

describe("parseCorrections", () => {
  it("requires a source, a check date and a field to set", () => {
    expect(() =>
      parseCorrections("corrections:\n  - domain: acme.example\n    set: {}\n"),
    ).toThrow();
    expect(() =>
      parseCorrections(
        "corrections:\n  - domain: acme.example\n    set: { email: a@acme.example }\n    checked: 2026-10-07\n    note: x\n",
      ),
    ).toThrow();
  });

  it("refuses a domain that is not in its normal form", () => {
    expect(() =>
      parseCorrections(yaml.replace("domain: acme.example", "domain: www.acme.example")),
    ).toThrow(/normal form/);
  });
});

describe("exclusions", () => {
  const excluded = parseExclusions(`excluded:
  - domain: gone.example
    reason: The list dropped it.
    source_urls: [https://list.example/readme]
    checked: 2026-10-07
`);

  it("drops records on an excluded domain from every list", () => {
    const lists = dropExcluded(
      [
        [broker({ domain: "gone.example" }), broker({ domain: "acme.example" })],
        [broker({ domain: "gone.example" })],
      ],
      new Set(excluded.map((entry) => entry.domain)),
    );
    expect(lists.map((list) => list.map((b) => b.domain))).toEqual([["acme.example"], []]);
  });

  it("requires a reason, a source and a check date", () => {
    expect(() => parseExclusions("excluded:\n  - domain: gone.example\n")).toThrow();
  });
});
