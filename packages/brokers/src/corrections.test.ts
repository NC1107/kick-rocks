import type { Broker } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  applyCorrections,
  dropExcluded,
  parseCorrections,
  parseEmailRefusals,
  parseExclusions,
} from "./corrections.js";
import { mergeBrokers } from "./merge.js";

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

  it("moves a record to another category and drops a requirement its pages disprove", () => {
    const corrections = parseCorrections(`corrections:
  - domain: acme.example
    set: { category: people-search, remove_requirements: [paid] }
    source_urls: [https://acme.example/optout]
    checked: 2026-10-07
    note: The opt-out is free.
`);
    const [[fixed]] = applyCorrections(
      [[broker({ category: "registered-broker", requirements: ["paid", "record_url"] })]],
      corrections,
    );
    expect(fixed).toMatchObject({ category: "people-search", requirements: ["record_url"] });
  });

  it("adds a requirement, and a device-only broker with a rights page is no longer a form", () => {
    const corrections = parseCorrections(`corrections:
  - domain: acme.example
    set: { opt_out_url: null, add_requirements: [device_id] }
    source_urls: [https://acme.example/privacy]
    checked: 2026-10-07
    note: The form takes only a device identifier.
`);
    const [[fixed]] = applyCorrections(
      [
        [
          broker({
            privacyEmail: null,
            optOutUrl: "https://acme.example/optout",
            privacyRightsUrl: "https://acme.example/privacy/rights",
            contactMethod: "form",
          }),
        ],
      ],
      corrections,
    );
    expect(fixed).toMatchObject({
      optOutUrl: null,
      requirements: ["device_id"],
      contactMethod: "unknown",
    });
  });

  it("refuses a requirement correction that the record already satisfies", () => {
    const corrections = parseCorrections(`corrections:
  - domain: acme.example
    set: { remove_requirements: [paid] }
    source_urls: [https://acme.example/optout]
    checked: 2026-10-07
    note: The opt-out is free.
`);
    expect(() => applyCorrections([[broker({})]], corrections)).toThrow(/change nothing/);
  });

  it("refuses a category that the merge already takes from another list", () => {
    const corrections = parseCorrections(`corrections:
  - domain: acme.example
    set: { category: people-search }
    source_urls: [https://acme.example/optout]
    checked: 2026-10-07
    note: It is a people search site.
`);
    const merge = (lists: readonly (readonly Broker[])[]) => mergeBrokers([...lists], {});
    const registry = broker({ category: "registered-broker" });
    const eraser = broker({ category: "people-search" });
    expect(() => applyCorrections([[registry], [eraser]], corrections, merge)).toThrow(
      /another list carries them: acme.example/,
    );
    expect(() => applyCorrections([[registry]], corrections, merge)).not.toThrow();
  });

  it("refuses a requirement removal that no matched record still carries", () => {
    const corrections = parseCorrections(`corrections:
  - domain: acme.example
    set: { remove_requirements: [paid, captcha] }
    source_urls: [https://acme.example/optout]
    checked: 2026-10-07
    note: The opt-out is free and has no captcha.
`);
    expect(() => applyCorrections([[broker({ requirements: ["paid"] })]], corrections)).toThrow(
      /acme.example \(captcha\)/,
    );
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

describe("parseEmailRefusals", () => {
  const entry = (extra = "") => `email_refused:
  - domain: acme.example
${extra}    source_urls: [https://acme.example/reply]
    checked: 2026-10-08
    note: Reply says email is not processed.
`;

  it("reads a refusal with and without an address", () => {
    expect(parseEmailRefusals(entry())).toHaveLength(1);
    expect(parseEmailRefusals(entry("    address: old@acme.example\n"))[0]?.address).toBe(
      "old@acme.example",
    );
  });

  it("rejects an address that is not lower case, because merged addresses are compared lower case", () => {
    expect(() => parseEmailRefusals(entry("    address: Old@acme.example\n"))).toThrow(
      /not lower case/,
    );
  });

  it("rejects a domain that is not in its normal form", () => {
    expect(() => parseEmailRefusals(entry().replace("acme.example", "WWW.Acme.example"))).toThrow(
      /normal form/,
    );
  });

  it("is ignored by parseCorrections, which reads the same file", () => {
    expect(parseCorrections(`${yaml}\n${entry()}`)).toHaveLength(1);
  });
});
