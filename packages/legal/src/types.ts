import type {
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

export type EmailKind = "initial" | "follow_up" | "verification_reply";

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

/** The four calls the server makes into the legal package. */
export interface LegalApi {
  /**
   * The statute that backs a request from this state on this date, or a policy-based basis that
   * asks the business to honor its own published privacy commitments.
   */
  resolveLegalBasis(state: StateCode, asOf: Date): LegalBasis;
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
