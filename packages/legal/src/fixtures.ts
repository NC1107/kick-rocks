import type { Identity, Reference, TargetSummary } from "@kickrocks/shared";

export const REFERENCE = "KR-7K3M9Q" as Reference;

export function makeTarget(overrides: Partial<TargetSummary> = {}): TargetSummary {
  return {
    id: "acme-marketing",
    kind: "broker",
    name: "Acme Marketing Data",
    category: "marketing",
    domain: "acme-marketing.example.com",
    website: "https://acme-marketing.example.com",
    optOutUrl: null,
    searchUrl: null,
    contactMethod: "email",
    requiresId: false,
    requirements: [],
    priority: "normal",
    needsRecord: false,
    retired: false,
    ...overrides,
  };
}

export const PEOPLE_SEARCH = makeTarget({
  id: "findpeople",
  name: "FindPeople Example",
  category: "people-search",
  domain: "findpeople.example.com",
  needsRecord: true,
});

export const COMPANY = makeTarget({
  id: "shopco",
  kind: "company",
  name: "ShopCo Example",
  category: "retail",
  domain: "shopco.example.com",
});

export const CA_REGISTERED = makeTarget({
  id: "registry-only",
  name: "Registry Only Data",
  category: "registered-broker",
  domain: "registry-only.example.com",
});

/** A person with every identity kind, so a test can see what a purpose leaves out. */
export function jordan(): Identity[] {
  return [
    {
      id: "n1",
      kind: "name",
      value: { first: "Jordan", middle: "Q", last: "Example" },
      isPrimary: true,
      validFrom: null,
      validTo: null,
    },
    {
      id: "n2",
      kind: "alias",
      value: { first: "Jo", last: "Sample" },
      isPrimary: false,
      validFrom: null,
      validTo: null,
    },
    {
      id: "e1",
      kind: "email",
      value: { address: "jordan@example.org" },
      isPrimary: true,
      validFrom: null,
      validTo: null,
    },
    {
      id: "p1",
      kind: "phone",
      value: { number: "+15555550123" },
      isPrimary: true,
      validFrom: null,
      validTo: null,
    },
    {
      id: "a1",
      kind: "address",
      value: {
        street: "12 Example Street",
        unit: "4B",
        city: "Springfield",
        state: "TX",
        zip: "75001",
      },
      isPrimary: true,
      validFrom: "2020-01-01",
      validTo: null,
    },
    {
      id: "a0",
      kind: "address",
      value: { street: "9 Old Road", city: "Oldtown", state: "OR", zip: "97001" },
      isPrimary: false,
      validFrom: null,
      validTo: "2019-12-31",
    },
    {
      id: "d1",
      kind: "dob",
      value: { date: "1990-04-02" },
      isPrimary: true,
      validFrom: null,
      validTo: null,
    },
  ];
}

export const SENDER = { name: "Jordan Q Example", address: "jordan@example.org" };
