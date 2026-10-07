import { describe, expect, it } from "vitest";
import {
  currentIdentity,
  formatFullName,
  type Identity,
  IdentityInput,
  IdentityInputList,
  resolveProfileFields,
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

describe("formatFullName", () => {
  it("skips a missing middle name", () => {
    expect(formatFullName({ first: "Jordan", last: "Example" })).toBe("Jordan Example");
    expect(formatFullName({ first: "Jordan", middle: "Q", last: "Example" })).toBe(
      "Jordan Q Example",
    );
  });
});
