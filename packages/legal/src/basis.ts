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
import { STATUTES, splitRights, traitsOf } from "./statutes.js";
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

const BUSINESS_DAYS_PER_WEEK = 5;
const DAYS_PER_WEEK = 7;

/** Calendar days that always hold the statute's business-day opt-out deadline. */
function responseDaysFor(statute: Statute, rights: readonly RequestRight[] | undefined): number {
  const { optOutBusinessDays } = traitsOf(statute.id);
  const optsOutOnly =
    rights !== undefined && rights.length > 0 && rights.every((right) => right === "opt_out");
  if (optOutBusinessDays === null || !optsOutOnly) return statute.responseDays;
  return Math.ceil((optOutBusinessDays * DAYS_PER_WEEK) / BUSINESS_DAYS_PER_WEEK);
}

function statuteBasis(statute: Statute, rights?: readonly RequestRight[]): LegalBasis {
  return {
    id: statute.id,
    kind: "statute",
    state: statute.state,
    statute,
    responseDays: responseDaysFor(statute, rights),
  };
}

function isInEffect(statute: Statute, asOf: Date): boolean {
  return asOf.getTime() >= Date.parse(`${statute.effectiveDate}T00:00:00Z`);
}

/** A statute backs a request when it reaches at least one right asked for; the rest go to policy. */
function covers(
  statute: Statute,
  rights: readonly RequestRight[],
  targetKind: "broker" | "company",
): boolean {
  return (
    traitsOf(statute.id).citable && splitRights(statute, rights, targetKind).covered.length > 0
  );
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
  return match ? statuteBasis(match, rights) : policyBasis(state);
}

export function getLegalBasis(
  id: string,
  state: StateCode,
  rights?: readonly RequestRight[],
): LegalBasis | null {
  const parsedState = StateCode.safeParse(state);
  if (!parsedState.success) return null;
  if (id === POLICY_BASIS_ID) return policyBasis(parsedState.data);
  const statute = STATUTES_BY_ID.get(id);
  if (!statute || statute.state !== parsedState.data) return null;
  return statuteBasis(statute, rights);
}

export function listJurisdictions(): Jurisdiction[] {
  return US_STATES.map(({ code }) => ({
    state: code,
    statutes: STATUTES.filter((statute) => statute.state === code),
  }));
}
