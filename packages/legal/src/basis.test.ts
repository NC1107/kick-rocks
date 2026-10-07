import { LegalBasis, POLICY_BASIS_ID, POLICY_RESPONSE_DAYS, US_STATES } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { CA_REGISTERED, COMPANY, makeTarget, PEOPLE_SEARCH } from "./fixtures.js";
import {
  getLegalBasis,
  LegalInputError,
  listJurisdictions,
  recommendDrop,
  resolveLegalBasis,
} from "./index.js";
import { STATUTES } from "./statutes.js";

const NOW = new Date("2026-10-07T12:00:00Z");
const BROKER = makeTarget();

describe("resolveLegalBasis", () => {
  it("cites the state statute when it is in effect and covers both rights", () => {
    const basis = resolveLegalBasis({
      state: "TX",
      target: BROKER,
      rights: ["opt_out", "delete"],
      asOf: NOW,
    });
    expect(basis).toMatchObject({ id: "tx-tdpsa", kind: "statute", state: "TX", responseDays: 45 });
    expect(LegalBasis.safeParse(basis).success).toBe(true);
  });

  it("falls back to a policy basis where no statute exists", () => {
    const basis = resolveLegalBasis({ state: "WY", target: BROKER, rights: ["delete"], asOf: NOW });
    expect(basis).toEqual({
      id: POLICY_BASIS_ID,
      kind: "policy",
      state: "WY",
      statute: null,
      responseDays: POLICY_RESPONSE_DAYS,
    });
  });

  it("uses the policy basis for a state whose law is not in effect yet, then the statute once it is", () => {
    const rights = ["opt_out"] as const;
    const before = resolveLegalBasis({
      state: "OK",
      target: BROKER,
      rights,
      asOf: new Date("2026-12-31T23:59:59Z"),
    });
    const on = resolveLegalBasis({
      state: "OK",
      target: BROKER,
      rights,
      asOf: new Date("2027-01-01T00:00:00Z"),
    });
    expect(before.kind).toBe("policy");
    expect(on.id).toBe("ok-ocdpa");
  });

  it("applies each future law on its own effective date", () => {
    const dates: Record<string, string> = {
      AL: "2027-05-01",
      LA: "2027-01-01",
      OK: "2027-01-01",
      VT: "2028-01-01",
    };
    for (const [state, date] of Object.entries(dates)) {
      const rights = ["opt_out"] as const;
      const input = { state: state as "AL", target: BROKER, rights };
      const day = Date.parse(`${date}T00:00:00Z`);
      expect(resolveLegalBasis({ ...input, asOf: new Date(day - 1) }).kind, state).toBe("policy");
      expect(resolveLegalBasis({ ...input, asOf: new Date(day) }).kind, state).toBe("statute");
    }
  });

  it("has a statute in effect today for every state that has one, except Florida", () => {
    const withLaw = new Set(
      STATUTES.filter((s) => Date.parse(s.effectiveDate) <= NOW.getTime()).map((s) => s.state),
    );
    for (const { code } of US_STATES) {
      const basis = resolveLegalBasis({
        state: code,
        target: COMPANY,
        rights: ["opt_out"],
        asOf: NOW,
      });
      const expected = withLaw.has(code) && code !== "FL" ? "statute" : "policy";
      expect(basis.kind, code).toBe(expected);
    }
  });

  it("cites the statute for the opt-out when a broker request also asks for deletion", () => {
    for (const [state, id] of [
      ["UT", "ut-ucpa"],
      ["IA", "ia-icdpa"],
      ["CA", "ca-ccpa"],
    ] as const) {
      const basis = resolveLegalBasis({
        state,
        target: BROKER,
        rights: ["opt_out", "delete"],
        asOf: NOW,
      });
      expect(basis.id, state).toBe(id);
    }
  });

  it("gives Nevada residents the NRS 603A opt-out against brokers and companies, and no deletion right", () => {
    for (const target of [BROKER, COMPANY]) {
      const optOut = resolveLegalBasis({ state: "NV", target, rights: ["opt_out"], asOf: NOW });
      expect(optOut).toMatchObject({ id: "nv-nrs-603a", responseDays: 60 });
      expect(optOut.statute?.extensionDays).toBe(30);
      const both = resolveLegalBasis({
        state: "NV",
        target,
        rights: ["opt_out", "delete"],
        asOf: NOW,
      });
      expect(both.id).toBe("nv-nrs-603a");
      expect(resolveLegalBasis({ state: "NV", target, rights: ["delete"], asOf: NOW }).kind).toBe(
        "policy",
      );
    }
    const before = resolveLegalBasis({
      state: "NV",
      target: BROKER,
      rights: ["opt_out"],
      asOf: new Date("2021-09-30T00:00:00Z"),
    });
    expect(before.kind).toBe("policy");
  });

  it("gives a California request that only opts out the 15 business day window", () => {
    const base = { state: "CA" as const, target: BROKER, asOf: NOW };
    expect(resolveLegalBasis({ ...base, rights: ["opt_out"] }).responseDays).toBe(21);
    expect(getLegalBasis("ca-ccpa", "CA", ["opt_out"])?.responseDays).toBe(21);
    expect(resolveLegalBasis({ ...base, rights: ["opt_out", "delete"] }).responseDays).toBe(45);
    expect(getLegalBasis("ca-ccpa", "CA")?.responseDays).toBe(45);
    const texas = resolveLegalBasis({
      state: "TX",
      target: BROKER,
      rights: ["opt_out"],
      asOf: NOW,
    });
    expect(texas.responseDays).toBe(45);
  });

  it("does not claim Florida's law, which binds only very large controllers", () => {
    const basis = resolveLegalBasis({
      state: "FL",
      target: BROKER,
      rights: ["opt_out", "delete"],
      asOf: NOW,
    });
    expect(basis.kind).toBe("policy");
    expect(getLegalBasis("fl-fdbr", "FL")?.kind).toBe("statute");
  });

  it("does not claim a deletion right the statute limits to data the person provided, against a broker", () => {
    for (const state of ["UT", "IA"] as const) {
      const toBroker = resolveLegalBasis({ state, target: BROKER, rights: ["delete"], asOf: NOW });
      const optOut = resolveLegalBasis({ state, target: BROKER, rights: ["opt_out"], asOf: NOW });
      const toCompany = resolveLegalBasis({
        state,
        target: COMPANY,
        rights: ["delete"],
        asOf: NOW,
      });
      expect(toBroker.kind, `${state} broker delete`).toBe("policy");
      expect(optOut.kind, `${state} broker opt out`).toBe("statute");
      expect(toCompany.kind, `${state} company delete`).toBe("statute");
    }
  });

  it("prefers the Delete Act for a deletion request to a California registered broker", () => {
    const basis = resolveLegalBasis({
      state: "CA",
      target: CA_REGISTERED,
      rights: ["delete"],
      asOf: NOW,
    });
    expect(basis.id).toBe("ca-delete-act");
    expect(basis.statute?.platform?.name).toContain("DROP");
  });

  it("recognises a California registered broker whose category is more specific", () => {
    const basis = resolveLegalBasis({
      state: "CA",
      target: { ...PEOPLE_SEARCH, californiaRegistered: true },
      rights: ["delete"],
      asOf: NOW,
    });
    expect(basis.id).toBe("ca-delete-act");
  });

  it("uses the CCPA when the Delete Act is not the right route", () => {
    const base = { state: "CA" as const, asOf: NOW };
    expect(resolveLegalBasis({ ...base, target: CA_REGISTERED, rights: ["opt_out"] }).id).toBe(
      "ca-ccpa",
    );
    expect(
      resolveLegalBasis({ ...base, target: CA_REGISTERED, rights: ["opt_out", "delete"] }).id,
    ).toBe("ca-ccpa");
    expect(resolveLegalBasis({ ...base, target: COMPANY, rights: ["delete"] }).id).toBe("ca-ccpa");
    expect(
      resolveLegalBasis({
        ...base,
        target: { ...COMPANY, californiaRegistered: true },
        rights: ["delete"],
      }).id,
    ).toBe("ca-ccpa");
  });

  it("does not claim a CCPA deletion right against a broker, which did not collect the data from the person", () => {
    const base = { state: "CA" as const, asOf: NOW };
    for (const target of [BROKER, PEOPLE_SEARCH]) {
      expect(resolveLegalBasis({ ...base, target, rights: ["delete"] }).kind).toBe("policy");
    }
  });

  it("uses the CCPA for a registered broker before the Delete Act processing date", () => {
    const basis = resolveLegalBasis({
      state: "CA",
      target: CA_REGISTERED,
      rights: ["opt_out", "delete"],
      asOf: new Date("2026-07-31T23:59:59Z"),
    });
    expect(basis.id).toBe("ca-ccpa");
  });

  it("never uses the Delete Act outside California", () => {
    const basis = resolveLegalBasis({
      state: "TX",
      target: CA_REGISTERED,
      rights: ["delete"],
      asOf: NOW,
    });
    expect(basis.id).toBe("tx-tdpsa");
  });

  it("returns the same basis for the same rights in either order and with duplicates", () => {
    const a = resolveLegalBasis({
      state: "VA",
      target: BROKER,
      rights: ["opt_out", "delete"],
      asOf: NOW,
    });
    const b = resolveLegalBasis({
      state: "VA",
      target: BROKER,
      rights: ["delete", "opt_out", "delete"],
      asOf: NOW,
    });
    expect(b).toEqual(a);
  });

  it("rejects input it cannot act on", () => {
    const ok = { state: "TX", target: BROKER, rights: ["delete"], asOf: NOW } as const;
    expect(() => resolveLegalBasis({ ...ok, rights: [] })).toThrow(LegalInputError);
    expect(() => resolveLegalBasis({ ...ok, state: "ZZ" as never })).toThrow(LegalInputError);
    expect(() => resolveLegalBasis({ ...ok, asOf: new Date("nope") })).toThrow(LegalInputError);
    expect(() => resolveLegalBasis({ ...ok, rights: ["sell" as never] })).toThrow(LegalInputError);
    expect(() => resolveLegalBasis({ ...ok, target: undefined as never })).toThrow(LegalInputError);
  });
});

describe("getLegalBasis", () => {
  it("returns a stored statute id as it is, whatever the date", () => {
    expect(getLegalBasis("va-vcdpa", "VA")).toMatchObject({
      id: "va-vcdpa",
      kind: "statute",
      responseDays: 45,
    });
    expect(getLegalBasis("ia-icdpa", "IA")?.responseDays).toBe(90);
  });

  it("returns the policy basis for any state", () => {
    expect(getLegalBasis(POLICY_BASIS_ID, "WY")).toMatchObject({
      kind: "policy",
      state: "WY",
      statute: null,
    });
  });

  it("is null for an unknown id, a statute of another state, or a bad state", () => {
    expect(getLegalBasis("nope", "TX")).toBeNull();
    expect(getLegalBasis("tx-tdpsa", "VA")).toBeNull();
    expect(getLegalBasis("tx-tdpsa", "ZZ" as never)).toBeNull();
    expect(getLegalBasis("", "TX")).toBeNull();
  });

  it("round-trips every basis resolveLegalBasis can return", () => {
    for (const { state } of listJurisdictions()) {
      for (const target of [BROKER, COMPANY, CA_REGISTERED]) {
        for (const rights of [["opt_out"], ["delete"], ["opt_out", "delete"]] as const) {
          const basis = resolveLegalBasis({
            state,
            target,
            rights,
            asOf: new Date("2029-01-01T00:00:00Z"),
          });
          expect(
            getLegalBasis(basis.id, state, rights),
            `${state} ${target.id} ${rights.join("+")}`,
          ).toEqual(basis);
        }
      }
    }
  });
});

describe("recommendDrop", () => {
  const AFTER = new Date("2026-08-01T00:00:00Z");
  const BEFORE = new Date("2026-07-31T23:59:59Z");
  const base = { state: "CA" as const, target: CA_REGISTERED, asOf: AFTER };

  it("recommends DROP for a deletion from a California resident to a California registered broker", () => {
    for (const rights of [["delete"], ["opt_out", "delete"]] as const) {
      const result = recommendDrop({ ...base, rights });
      expect(result).toMatchObject({ recommended: true, reason: "recommended" });
      expect(result.platform?.url).toBe("https://privacy.ca.gov/drop/");
    }
  });

  it("does not recommend it before brokers must process requests", () => {
    expect(recommendDrop({ ...base, rights: ["delete"], asOf: BEFORE })).toEqual({
      recommended: false,
      reason: "not_yet_processed",
      platform: null,
    });
  });

  it("does not recommend it for an opt-out alone, which DROP does not carry", () => {
    expect(recommendDrop({ ...base, rights: ["opt_out"] }).reason).toBe("no_deletion_asked");
  });

  it("does not recommend it for a broker outside the California registry, a company, or another state", () => {
    expect(recommendDrop({ ...base, target: BROKER, rights: ["delete"] }).reason).toBe(
      "not_a_registered_broker",
    );
    expect(recommendDrop({ ...base, target: COMPANY, rights: ["delete"] }).reason).toBe(
      "not_a_registered_broker",
    );
    expect(recommendDrop({ ...base, state: "TX", rights: ["delete"] }).reason).toBe(
      "not_california",
    );
  });

  it("agrees with the legal basis, which is the Delete Act only for a deletion-only request", () => {
    expect(resolveLegalBasis({ ...base, rights: ["delete"] }).id).toBe("ca-delete-act");
    expect(resolveLegalBasis({ ...base, rights: ["opt_out", "delete"] }).id).toBe("ca-ccpa");
  });

  it("rejects input it cannot read", () => {
    expect(() => recommendDrop({ ...base, rights: [] })).toThrow(LegalInputError);
  });
});

describe("California deletion against brokers", () => {
  it("never cites the CCPA deletion right to a broker, because it reaches only data collected from the consumer", () => {
    for (const target of [BROKER, CA_REGISTERED]) {
      const basis = resolveLegalBasis({
        state: "CA",
        target,
        rights: ["delete"],
        asOf: new Date("2026-07-31T00:00:00Z"),
      });
      expect(basis.kind).toBe("policy");
    }
  });

  it("still cites the CCPA deletion right to a company, for the data the person provided", () => {
    const basis = resolveLegalBasis({
      state: "CA",
      target: COMPANY,
      rights: ["delete"],
      asOf: NOW,
    });
    expect(basis.id).toBe("ca-ccpa");
  });
});
