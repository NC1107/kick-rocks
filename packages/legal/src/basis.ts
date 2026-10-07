import {
  type Jurisdiction,
  type LegalBasis,
  POLICY_BASIS_ID,
  POLICY_RESPONSE_DAYS,
  RequestRight,
  StateCode,
  type Statute,
  US_STATES,
} from "@kickrocks/shared";
import { z } from "zod";
import { LegalInputError } from "./errors.js";
import { STATUTES, traitsOf } from "./statutes.js";
import type { ResolveLegalBasisInput } from "./types.js";

const ResolveInput = z.object({
  state: StateCode,
  target: z.object({ kind: z.enum(["broker", "company"]), category: z.string() }).loose(),
  rights: z.array(RequestRight).min(1),
  asOf: z.date().refine((date) => !Number.isNaN(date.getTime()), "asOf is not a valid date"),
});

const STATUTES_BY_ID = new Map(STATUTES.map((statute) => [statute.id, statute]));

const CALIFORNIA_DELETE_ACT = "ca-delete-act";

function policyBasis(state: StateCode): LegalBasis {
  return {
    id: POLICY_BASIS_ID,
    kind: "policy",
    state,
    statute: null,
    responseDays: POLICY_RESPONSE_DAYS,
  };
}

function statuteBasis(statute: Statute): LegalBasis {
  return {
    id: statute.id,
    kind: "statute",
    state: statute.state,
    statute,
    responseDays: statute.responseDays,
  };
}

function isInEffect(statute: Statute, asOf: Date): boolean {
  return asOf.getTime() >= Date.parse(`${statute.effectiveDate}T00:00:00Z`);
}

function covers(
  statute: Statute,
  rights: readonly RequestRight[],
  targetKind: "broker" | "company",
): boolean {
  const { deleteScope, citable } = traitsOf(statute.id);
  if (!citable) return false;
  return rights.every((right) => {
    if (!statute.rights.includes(right)) return false;
    // A broker never received the data from the person, so a right limited to data the person
    // provided does not reach it.
    return !(right === "delete" && deleteScope === "provided" && targetKind === "broker");
  });
}

/**
 * California's Delete Act and DROP exist for brokers registered in California, and DROP only
 * deletes. A request for anything more, or to a company, is a CCPA request.
 */
function isDropRequest(input: ResolveLegalBasisInput): boolean {
  return (
    input.state === "CA" &&
    input.target.kind === "broker" &&
    input.target.californiaRegistered &&
    input.rights.every((right) => right === "delete")
  );
}

export function resolveLegalBasis(input: ResolveLegalBasisInput): LegalBasis {
  const parsed = ResolveInput.safeParse(input);
  if (!parsed.success) {
    throw new LegalInputError(`Cannot resolve a legal basis: ${z.prettifyError(parsed.error)}`);
  }
  const { state, rights, asOf } = parsed.data;
  const targetKind = parsed.data.target.kind;

  const deleteAct = STATUTES_BY_ID.get(CALIFORNIA_DELETE_ACT);
  if (deleteAct && isDropRequest(input) && isInEffect(deleteAct, asOf)) {
    return statuteBasis(deleteAct);
  }

  const match = STATUTES.find(
    (statute) =>
      statute.state === state &&
      statute.id !== CALIFORNIA_DELETE_ACT &&
      isInEffect(statute, asOf) &&
      covers(statute, rights, targetKind),
  );
  return match ? statuteBasis(match) : policyBasis(state);
}

export function getLegalBasis(id: string, state: StateCode): LegalBasis | null {
  const parsedState = StateCode.safeParse(state);
  if (!parsedState.success) return null;
  if (id === POLICY_BASIS_ID) return policyBasis(parsedState.data);
  const statute = STATUTES_BY_ID.get(id);
  if (!statute || statute.state !== parsedState.data) return null;
  return statuteBasis(statute);
}

export function listJurisdictions(): Jurisdiction[] {
  return US_STATES.map(({ code }) => ({
    state: code,
    statutes: STATUTES.filter((statute) => statute.state === code),
  }));
}
