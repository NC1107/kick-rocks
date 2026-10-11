import { describe, expect, it } from "vitest";
import {
  currentIdentity,
  formatFullName,
  formatStreetLine,
  type Identity,
  IdentityInput,
  IdentityInputList,
  normalizeAddress,
  resolveProfileFields,
  splitTrailingUnit,
  validateIdentities,
} from "./identities.js";

function identity(overrides: Partial<Identity> & Pick<Identity, "kind" | "value">): Identity {
  return { id: "i", isPrimary: false, validFrom: null, validTo: null, ...overrides } as Identity;
}

const jordan: Identity[] = [
  identity({
    id: "n1",
    kind: "name",
    value: { first: "Jordan", middle: "Q", last: "Example" },
    isPrimary: true,
  }),
  identity({ id: "n2", kind: "alias", value: { first: "Jo", last: "Example" } }),
  identity({ id: "e1", kind: "email", value: { address: "jordan@example.com" }, isPrimary: true }),
  identity({ id: "e2", kind: "email", value: { address: "old@example.org" } }),
  identity({ id: "p1", kind: "phone", value: { number: "+15555550123" } }),
  identity({
    id: "a1",
    kind: "address",
    value: { street: "1 Main St", unit: "Apt 2", city: "Austin", state: "TX", zip: "78701" },
    isPrimary: true,
  }),
  identity({ id: "d1", kind: "dob", value: { date: "1990-04-05" } }),
];

describe("identity value schemas", () => {
  it("accepts a valid value for each kind", () => {
    for (const { id: _id, ...input } of jordan) {
      expect(IdentityInput.safeParse(input).success).toBe(true);
    }
  });

  it("applies defaults for the lifetime fields", () => {
    const parsed = IdentityInput.parse({ kind: "email", value: { address: "a@example.com" } });
    expect(parsed).toMatchObject({ isPrimary: false, validFrom: null, validTo: null });
  });

  it("rejects values that do not match their kind", () => {
    expect(IdentityInput.safeParse({ kind: "email", value: { address: "nope" } }).success).toBe(
      false,
    );
    expect(IdentityInput.safeParse({ kind: "phone", value: { number: "555-0123" } }).success).toBe(
      false,
    );
    expect(IdentityInput.safeParse({ kind: "dob", value: { date: "1990-13-40" } }).success).toBe(
      false,
    );
    expect(
      IdentityInput.safeParse({
        kind: "address",
        value: { street: "1 Main St", city: "Austin", state: "ZZ", zip: "78701" },
      }).success,
    ).toBe(false);
    expect(
      IdentityInput.safeParse({
        kind: "address",
        value: { street: "1 Main St", city: "Austin", state: "TX", zip: "7870" },
      }).success,
    ).toBe(false);
    expect(IdentityInput.safeParse({ kind: "name", value: { first: "", last: "X" } }).success).toBe(
      false,
    );
    expect(IdentityInput.safeParse({ kind: "nickname", value: {} }).success).toBe(false);
  });

  it("trims names", () => {
    const parsed = IdentityInput.parse({ kind: "name", value: { first: " Jo ", last: " Ex " } });
    expect(parsed.value).toEqual({ first: "Jo", last: "Ex" });
  });
});

describe("validateIdentities", () => {
  const today = "2026-10-07";
  const base = [
    {
      kind: "name",
      value: { first: "A", last: "B" },
      isPrimary: true,
      validFrom: null,
      validTo: null,
    },
    {
      kind: "email",
      value: { address: "a@example.com" },
      isPrimary: true,
      validFrom: null,
      validTo: null,
    },
  ] as const;

  it("accepts a minimal valid set", () => {
    expect(validateIdentities(base, today)).toEqual([]);
  });

  it("requires exactly one primary name", () => {
    const none = [{ ...base[0], isPrimary: false }, base[1]];
    expect(validateIdentities(none, today).map((i) => i.message)).toContain(
      "Exactly one primary name is required",
    );
    const two = [base[0], base[0], base[1]];
    expect(validateIdentities(two, today).map((i) => i.message)).toContain(
      "Only one primary name is allowed",
    );
    expect(validateIdentities([base[1]], today).map((i) => i.message)).toContain(
      "Exactly one primary name is required",
    );
  });

  it("requires an email", () => {
    expect(validateIdentities([base[0]], today).map((i) => i.message)).toContain(
      "At least one email is required",
    );
  });

  it("rejects an inverted validity window", () => {
    const issues = validateIdentities(
      [
        ...base,
        {
          kind: "phone",
          value: { number: "+15555550123" },
          isPrimary: false,
          validFrom: "2024-01-01",
          validTo: "2023-01-01",
        },
      ],
      today,
    );
    expect(issues).toEqual([
      { path: [2, "validTo"], message: "Must not be before the start date" },
    ]);
  });

  it("rejects implausible dates of birth", () => {
    const future = validateIdentities(
      [
        ...base,
        {
          kind: "dob",
          value: { date: "2030-01-01" },
          isPrimary: false,
          validFrom: null,
          validTo: null,
        },
      ],
      today,
    );
    const ancient = validateIdentities(
      [
        ...base,
        {
          kind: "dob",
          value: { date: "1850-01-01" },
          isPrimary: false,
          validFrom: null,
          validTo: null,
        },
      ],
      today,
    );
    expect(future).toHaveLength(1);
    expect(ancient).toHaveLength(1);
  });
});

describe("IdentityInputList", () => {
  it("applies the cross-identity rules", () => {
    const result = IdentityInputList.safeParse([
      { kind: "name", value: { first: "A", last: "B" }, isPrimary: true },
    ]);
    expect(result.success).toBe(false);
    expect(
      IdentityInputList.safeParse([
        { kind: "name", value: { first: "A", last: "B" }, isPrimary: true },
        { kind: "email", value: { address: "a@example.com" } },
      ]).success,
    ).toBe(true);
  });
});

describe("currentIdentity", () => {
  it("prefers the primary identity", () => {
    expect(currentIdentity(jordan, "email", "2026-01-01")?.value.address).toBe(
      "jordan@example.com",
    );
  });

  it("skips identities outside their validity window", () => {
    const moved: Identity[] = [
      identity({
        id: "a-old",
        kind: "address",
        isPrimary: true,
        validTo: "2020-12-31",
        value: { street: "9 Old Rd", city: "Dallas", state: "TX", zip: "75001" },
      }),
      identity({
        id: "a-new",
        kind: "address",
        validFrom: "2021-01-01",
        value: { street: "2 New Rd", city: "Austin", state: "TX", zip: "78701" },
      }),
    ];
    expect(currentIdentity(moved, "address", "2020-06-01")?.value.city).toBe("Dallas");
    expect(currentIdentity(moved, "address", "2026-01-01")?.value.city).toBe("Austin");
  });

  it("returns null when nothing matches", () => {
    expect(currentIdentity([], "phone", "2026-01-01")).toBeNull();
  });
});

describe("resolveProfileFields", () => {
  const context = { asOf: "2026-10-07", recordUrl: "https://spokeo.test/jordan" };

  it("resolves every field from identities", () => {
    const fields = resolveProfileFields(
      jordan,
      [
        "first_name",
        "last_name",
        "full_name",
        "email",
        "phone",
        "city",
        "state",
        "zip",
        "street",
        "birth_year",
        "date_of_birth",
        "record_url",
      ],
      context,
    );
    expect(fields).toEqual({
      first_name: "Jordan",
      last_name: "Example",
      full_name: "Jordan Q Example",
      email: "jordan@example.com",
      phone: "+15555550123",
      city: "Austin",
      state: "TX",
      zip: "78701",
      street: "1 Main St Apt 2",
      birth_year: "1990",
      date_of_birth: "1990-04-05",
      record_url: "https://spokeo.test/jordan",
    });
  });

  it("returns only what was requested", () => {
    expect(resolveProfileFields(jordan, ["email"], context)).toEqual({
      email: "jordan@example.com",
    });
    expect(resolveProfileFields(jordan, [], context)).toEqual({});
  });

  it("omits fields with no identity or no record url", () => {
    const sparse = jordan.filter((i) => i.kind === "name" || i.kind === "email");
    expect(
      resolveProfileFields(sparse, ["phone", "zip", "record_url", "first_name"], {
        asOf: "2026-10-07",
      }),
    ).toEqual({
      first_name: "Jordan",
    });
  });

  it("never uses an alias for the name fields", () => {
    const aliasOnly = jordan.filter((i) => i.kind !== "name");
    expect(resolveProfileFields(aliasOnly, ["first_name"], context)).toEqual({});
  });
});

describe("resolveProfileFields for a past name or address", () => {
  const context = { asOf: "2026-10-07" };
  const withOldAddress: Identity[] = [
    ...jordan,
    identity({
      id: "a-old",
      kind: "address",
      validTo: "2020-12-31",
      value: { street: "9 Old Rd", city: "Dallas", state: "TX", zip: "75001" },
    }),
  ];

  it("uses the alias a scan asks for instead of the primary name", () => {
    expect(
      resolveProfileFields(jordan, ["first_name", "full_name"], { ...context, nameId: "n2" }),
    ).toEqual({ first_name: "Jo", full_name: "Jo Example" });
  });

  it("uses an address that is no longer current when asked for it by id", () => {
    expect(
      resolveProfileFields(withOldAddress, ["city", "zip"], { ...context, addressId: "a-old" }),
    ).toEqual({ city: "Dallas", zip: "75001" });
    expect(resolveProfileFields(withOldAddress, ["city"], context)).toEqual({ city: "Austin" });
  });

  it("leaves the field out when the identity asked for is not there, instead of using another", () => {
    expect(resolveProfileFields(jordan, ["first_name"], { ...context, nameId: "gone" })).toEqual(
      {},
    );
    expect(resolveProfileFields(jordan, ["city"], { ...context, addressId: "gone" })).toEqual({});
    expect(resolveProfileFields(jordan, ["first_name"], { ...context, nameId: "e1" })).toEqual({});
  });

  it("takes an alias only for the name and never for another kind", () => {
    expect(resolveProfileFields(jordan, ["city"], { ...context, addressId: "n2" })).toEqual({});
  });
});

describe("the date of birth upper bound", () => {
  const input = [
    { kind: "name", value: { first: "A", last: "B" }, isPrimary: true },
    { kind: "email", value: { address: "a@example.com" } },
    { kind: "dob", value: { date: "2999-01-01" } },
  ];

  it("is left to the caller that knows today, so the schema never reads the wall clock", () => {
    expect(IdentityInputList.safeParse(input).success).toBe(true);
    const parsed = IdentityInputList.parse(input);
    expect(validateIdentities(parsed, "2026-10-07").map((issue) => issue.message)).toEqual([
      "Date of birth is not plausible",
    ]);
  });

  it("still refuses a date before 1900 without knowing today", () => {
    expect(
      IdentityInputList.safeParse([
        ...input.slice(0, 2),
        { kind: "dob", value: { date: "1850-01-01" } },
      ]).success,
    ).toBe(false);
  });
});

describe("formatFullName", () => {
  it("skips a missing middle name", () => {
    expect(formatFullName({ first: "Jordan", last: "Example" })).toBe("Jordan Example");
    expect(formatFullName({ first: "Jordan", middle: "Q", last: "Example" })).toBe(
      "Jordan Q Example",
    );
  });
});

describe("an address whose unit was typed into the street as well", () => {
  const base = { city: "Sampleton", state: "CA", zip: "90000" } as const;

  it("is written once in the street line sent to sites and letters", () => {
    expect(formatStreetLine({ street: "500 Real Road Apt 12", unit: "Apt 12" })).toBe(
      "500 Real Road Apt 12",
    );
    const doubled = identity({
      kind: "address",
      value: { ...base, street: "500 Real Road Apt 12", unit: "Apt 12" },
    });
    expect(resolveProfileFields([doubled], ["street"], { asOf: "2026-01-01" })).toEqual({
      street: "500 Real Road Apt 12",
    });
  });

  it("still joins a street and a unit that are separate", () => {
    expect(formatStreetLine({ street: "100 Example Street", unit: "Apt 4" })).toBe(
      "100 Example Street Apt 4",
    );
    expect(formatStreetLine({ street: "100 Example Street" })).toBe("100 Example Street");
  });

  it("matches the unit ignoring case and the designator word", () => {
    expect(
      normalizeAddress({ ...base, street: "500 Real Road #12", unit: "apt 12" }),
    ).toMatchObject({
      street: "500 Real Road",
      unit: "apt 12",
    });
    expect(normalizeAddress({ ...base, street: "9 Oak Ln, Suite 3B", unit: "3b" }).street).toBe(
      "9 Oak Ln",
    );
  });

  it("moves a unit typed into the street when the unit field is empty", () => {
    expect(normalizeAddress({ ...base, street: "500 Real Road Apt 12" })).toEqual({
      ...base,
      street: "500 Real Road",
      unit: "Apt 12",
    });
    expect(splitTrailingUnit("77 Pine Ave, #4")).toEqual({ street: "77 Pine Ave", unit: "#4" });
  });

  it("leaves a street alone when its trailing number is part of the name", () => {
    expect(normalizeAddress({ ...base, street: "12 Highway 12", unit: "12" }).street).toBe(
      "12 Highway 12",
    );
    expect(normalizeAddress({ ...base, street: "Highway 12" })).toEqual({
      ...base,
      street: "Highway 12",
    });
  });

  it("keeps a different unit in the street apart from the one in Unit", () => {
    expect(normalizeAddress({ ...base, street: "1 A St Apt 3", unit: "Apt 4" }).street).toBe(
      "1 A St Apt 3",
    );
  });
});
