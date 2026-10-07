import { describe, expect, it } from "vitest";
import {
  Jurisdiction,
  LegalBasis,
  POLICY_BASIS_ID,
  POLICY_RESPONSE_DAYS,
  Statute,
} from "./legal.js";

const statute = {
  id: "ca-ccpa",
  state: "CA",
  kind: "comprehensive",
  name: "California Consumer Privacy Act",
  citation: "Cal. Civ. Code 1798.100 et seq.",
  effectiveDate: "2020-01-01",
  rights: ["opt_out", "delete"],
  responseDays: 45,
  extensionDays: 45,
  brokerNotes: null,
  platform: null,
  sourceUrl: "https://example.org/statute",
  notes: null,
};

describe("Statute", () => {
  it("accepts a complete statute", () => {
    expect(Statute.safeParse(statute).success).toBe(true);
  });

  it("requires at least one right and a primary source", () => {
    expect(Statute.safeParse({ ...statute, rights: [] }).success).toBe(false);
    expect(Statute.safeParse({ ...statute, sourceUrl: "nope" }).success).toBe(false);
  });
});

describe("Jurisdiction and LegalBasis", () => {
  it("allows a state with no statute", () => {
    expect(Jurisdiction.safeParse({ state: "WY", statutes: [] }).success).toBe(true);
  });

  it("describes the policy fallback", () => {
    const basis = {
      id: POLICY_BASIS_ID,
      kind: "policy",
      state: "WY",
      statute: null,
      responseDays: POLICY_RESPONSE_DAYS,
    };
    expect(LegalBasis.safeParse(basis).success).toBe(true);
  });
});
