import type {
  EmailKind,
  IdentifierPurpose,
  Identity,
  Jurisdiction,
  LegalBasis,
  ProfileField,
  ProfileFields,
  Reference,
  RenderedEmail,
  RequestRight,
  StateCode,
  TargetSummary,
} from "@kickrocks/shared";
import type { DropRecommendation } from "./basis.js";

export type { EmailKind };

/**
 * What decides which statute backs a request. The target matters because the data broker laws
 * (California's Delete Act, and Vermont, Texas, and Oregon's broker statutes) cover only data
 * brokers, and DROP is only the right route for a broker registered with California. The rights
 * matter because some statutes give a right to opt out of sale but not to deletion.
 */
export interface ResolveLegalBasisInput {
  /** The state of the person, never anything they say about residency. */
  state: StateCode;
  target: Pick<
    TargetSummary,
    "id" | "kind" | "category" | "domain" | "name" | "californiaRegistered"
  >;
  rights: readonly RequestRight[];
  asOf: Date;
}

export interface RenderRequestEmailInput {
  kind: EmailKind;
  rights: readonly RequestRight[];
  /** Goes in the subject so a reply can be matched to the request. */
  reference: Reference;
  basis: LegalBasis;
  target: Pick<TargetSummary, "name" | "domain" | "category" | "kind">;
  /** The data subject, who is also the sender. */
  sender: { name: string; address: string };
  /** What the email may disclose, already minimized by {@link LegalApi.identifiersFor}. */
  identifiers: ProfileFields;
  /** Required for a follow-up: which one this is and when the first request went out. */
  followUp?: { number: number; originalSentAt: string };
  /** Required for a verification reply: the identifiers the broker asked for, which the user approved. */
  verification?: { requestedFields: readonly ProfileField[] };
}

/** The calls the server makes into the legal package. */
export interface LegalApi {
  /**
   * The statute that backs a request for these rights to this target on this date, or a
   * policy-based basis that asks the business to honor its own published privacy commitments.
   */
  resolveLegalBasis(input: ResolveLegalBasisInput): LegalBasis;
  /**
   * The basis a stored id names, as it was, for a follow-up that must cite the statute the first
   * request cited even after a newer law takes effect. Null for an id the package does not know,
   * or one that belongs to another state.
   */
  getLegalBasis(
    id: string,
    state: StateCode,
    rights: readonly RequestRight[] | undefined,
    asOf: Date,
  ): LegalBasis | null;
  /** Whether the deletion part of a request is better filed once through a state platform such as DROP. */
  recommendDrop(input: ResolveLegalBasisInput): DropRecommendation;
  listJurisdictions(): Jurisdiction[];
  /**
   * The least that may be disclosed for a purpose, resolved from identities in force on `asOf`.
   * `requestedFields` are extras a recipe or an approved broker reply explicitly requires.
   */
  identifiersFor(
    target: TargetSummary,
    identities: readonly Identity[],
    purpose: IdentifierPurpose,
    requestedFields?: readonly ProfileField[],
    asOf?: Date,
  ): ProfileFields;
  renderRequestEmail(input: RenderRequestEmailInput): RenderedEmail;
}
