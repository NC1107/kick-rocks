import {
  type Broker,
  type Company,
  type IdentityInput,
  Recipe,
  type RecipeInput,
  type RecipePurpose,
  recipeId,
} from "@kickrocks/shared";

let sequence = 0;
const next = () => {
  sequence += 1;
  return sequence;
};

/** A valid broker. Everything not given derives from the id, so two brokers never share a domain. */
export function makeBroker(overrides: Partial<Broker> = {}): Broker {
  const id = overrides.id ?? `broker-${next()}`;
  const domain = overrides.domain ?? `${id}.test`;
  return {
    id,
    name: `Example Broker ${id}`,
    category: "marketing",
    website: `https://www.${domain}/`,
    domain,
    privacyEmail: `privacy@${domain}`,
    optOutUrl: `https://${domain}/optout`,
    privacyRightsUrl: null,
    searchUrl: null,
    contactMethod: "both",
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

export function makeCompany(overrides: Partial<Company> = {}): Company {
  const id = overrides.id ?? `company-${next()}`;
  const domain = overrides.domain ?? `${id}.test`;
  return {
    id,
    name: `Example Company ${id}`,
    domain,
    category: "retail",
    privacyEmail: `privacy@${domain}`,
    optOutUrl: null,
    privacyRightsUrl: `https://${domain}/privacy`,
    contactMethod: "email",
    notes: null,
    sources: [{ source: "kickrocks-companies", license: "PolyForm-Noncommercial-1.0.0" }],
    verifiedAt: "2026-10-01",
    ...overrides,
  };
}

export interface RecipeOverrides {
  brokerId: string;
  purpose?: RecipePurpose;
  version?: number;
  /** Merged over the generated recipe before it is validated. */
  definition?: Partial<RecipeInput>;
}

/**
 * A valid recipe for a fixture site on a .test domain. A scan recipe searches by name and reads
 * candidates; a remove recipe fills the record URL and email and submits.
 */
export function makeRecipe({
  brokerId,
  purpose = "remove",
  version = 1,
  definition = {},
}: RecipeOverrides): Recipe {
  const host = `https://${brokerId}.test`;
  const scan = {
    fields: ["first_name", "last_name", "city", "state"],
    steps: [
      { kind: "goto", url: `${host}/search/{{first_name|slug}}-{{last_name|slug}}` },
      { kind: "wait_for", target: { css: ".results" } },
      {
        kind: "extract_candidates",
        item: { css: ".result" },
        fields: {
          recordUrl: { css: "a.profile", attr: "href" },
          name: { css: ".name" },
          locations: { css: ".location", all: true },
        },
      },
    ],
    canary: { url: `${host}/search`, selectors: [{ css: "form.search" }] },
  };
  const remove = {
    fields: ["record_url", "email"],
    steps: [
      { kind: "goto", url: `${host}/optout` },
      { kind: "fill", target: { label: "Profile URL" }, field: "record_url" },
      { kind: "fill", target: { label: "Email" }, field: "email" },
      { kind: "click", target: { role: "button", label: "Remove" } },
      { kind: "expect_text", text: "request received" },
    ],
    canary: { url: `${host}/optout`, selectors: [{ label: "Email" }] },
  };
  return Recipe.parse({
    id: recipeId(brokerId, purpose, version),
    brokerId,
    version,
    purpose,
    entryUrl: `${host}/${purpose === "scan" ? "search" : "optout"}`,
    ...(purpose === "scan" ? scan : remove),
    ...definition,
  });
}

/** Jordan Example, who does not exist: every value is fake and on a reserved domain. */
export function jordanIdentities(): IdentityInput[] {
  return [
    {
      kind: "name",
      value: { first: "Jordan", middle: "Q", last: "Example" },
      isPrimary: true,
      validFrom: null,
      validTo: null,
    },
    {
      kind: "email",
      value: { address: "jordan@example.com" },
      isPrimary: true,
      validFrom: null,
      validTo: null,
    },
    {
      kind: "phone",
      value: { number: "+15555550123" },
      isPrimary: true,
      validFrom: null,
      validTo: null,
    },
    {
      kind: "address",
      value: { street: "100 Example Way", city: "Austin", state: "TX", zip: "78701" },
      isPrimary: true,
      validFrom: null,
      validTo: null,
    },
    { kind: "dob", value: { date: "1990-04-05" }, isPrimary: true, validFrom: null, validTo: null },
  ];
}
