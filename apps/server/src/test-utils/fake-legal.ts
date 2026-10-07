import type { LegalApi } from "@kickrocks/legal";
import {
  type Jurisdiction,
  type LegalBasis,
  POLICY_BASIS_ID,
  POLICY_RESPONSE_DAYS,
  type ProfileField,
  resolveProfileFields,
  type StateCode,
  type Statute,
} from "@kickrocks/shared";

/** The one statute the fake knows, so tests can see both a statute basis and a policy basis. */
export const FAKE_STATUTE: Statute = {
  id: "ca-test-act",
  state: "CA",
  kind: "comprehensive",
  name: "California Test Act",
  citation: "Test Code 1.1",
  effectiveDate: "2020-01-01",
  rights: ["opt_out", "delete"],
  responseDays: 45,
  extensionDays: 45,
  brokerNotes: null,
  platform: null,
  sourceUrl: "https://example.org/statutes/ca-test-act",
  notes: null,
};

const BASE_FIELDS = {
  email: ["full_name", "email"],
  scan: ["first_name", "last_name", "city", "state"],
  remove: ["full_name", "email"],
} as const satisfies Record<string, readonly ProfileField[]>;

/** A deterministic stand-in for @kickrocks/legal: California gets a statute, everyone else a policy. */
function policyBasis(state: StateCode): LegalBasis {
  return {
    id: POLICY_BASIS_ID,
    kind: "policy",
    state,
    statute: null,
    responseDays: POLICY_RESPONSE_DAYS,
  };
}

function statuteBasis(state: StateCode): LegalBasis {
  return {
    id: FAKE_STATUTE.id,
    kind: "statute",
    state,
    statute: FAKE_STATUTE,
    responseDays: FAKE_STATUTE.responseDays,
  };
}

export function createFakeLegal(): LegalApi {
  return {
    resolveLegalBasis({ state, rights, asOf }): LegalBasis {
      const covered = rights.every((right) => FAKE_STATUTE.rights.includes(right));
      if (state === "CA" && covered && asOf >= new Date(FAKE_STATUTE.effectiveDate)) {
        return statuteBasis(state);
      }
      return policyBasis(state);
    },

    getLegalBasis(id, state): LegalBasis | null {
      if (id === POLICY_BASIS_ID) return policyBasis(state);
      return id === FAKE_STATUTE.id && state === FAKE_STATUTE.state ? statuteBasis(state) : null;
    },

    listJurisdictions(): Jurisdiction[] {
      return [
        { state: "CA", statutes: [FAKE_STATUTE] },
        { state: "TX", statutes: [] },
      ];
    },

    identifiersFor(_target, identities, purpose, requestedFields = [], asOf = new Date()) {
      return resolveProfileFields(identities, [...BASE_FIELDS[purpose], ...requestedFields], {
        asOf: asOf.toISOString().slice(0, 10),
      });
    },

    renderRequestEmail(input) {
      const rights = input.rights.join(" and ");
      const prefix = input.kind === "follow_up" ? "Follow-up: " : "";
      return {
        subject: `${prefix}${rights} request ${input.reference}`,
        text: [
          `Reference: ${input.reference}`,
          `To: ${input.target.name}`,
          `Basis: ${input.basis.id}`,
          `Rights: ${rights}`,
          ...Object.entries(input.identifiers).map(([field, value]) => `${field}: ${value}`),
        ].join("\n"),
      };
    },
  };
}
