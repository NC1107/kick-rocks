import { z } from "zod";
import { StateCode } from "./geography.js";
import { RequestRight } from "./requests.js";
import { WebUrl } from "./url.js";

export const StatuteKind = z.enum(["comprehensive", "data_broker"]);
export type StatuteKind = z.infer<typeof StatuteKind>;

/** One privacy or data broker law, as encoded by the legal package. */
export const Statute = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  state: StateCode,
  kind: StatuteKind,
  name: z.string().min(1),
  citation: z.string().min(1),
  effectiveDate: z.iso.date(),
  /** Which rights the law gives a consumer against the businesses it covers. */
  rights: z.array(RequestRight).min(1),
  responseDays: z.number().int().positive(),
  extensionDays: z.number().int().nonnegative(),
  /** What the law says specifically about data brokers, when it does. */
  brokerNotes: z.string().nullable(),
  /** A state-run platform that handles requests centrally, such as California's DROP. */
  platform: z.object({ name: z.string(), url: WebUrl, note: z.string() }).nullable(),
  sourceUrl: WebUrl,
  notes: z.string().nullable(),
});
export type Statute = z.infer<typeof Statute>;

export const Jurisdiction = z.object({
  state: StateCode,
  statutes: z.array(Statute),
});
export type Jurisdiction = z.infer<typeof Jurisdiction>;

/** The id of the basis used when no statute applies. */
export const POLICY_BASIS_ID = "policy";

/** Days a business is asked to take when no statute sets a deadline. */
export const POLICY_RESPONSE_DAYS = 45;

/**
 * Why a request is entitled to an answer: a statute in effect, or the business's own
 * published privacy commitments when no statute applies.
 */
export const LegalBasis = z.object({
  /** The statute id, or {@link POLICY_BASIS_ID}. */
  id: z.string().min(1),
  kind: z.enum(["statute", "policy"]),
  state: StateCode,
  statute: Statute.nullable(),
  responseDays: z.number().int().positive(),
});
export type LegalBasis = z.infer<typeof LegalBasis>;

/**
 * What an identifier set is for. A blind email discloses the least; a scan and a removal form
 * disclose what finding and removing a record requires.
 */
export const IdentifierPurpose = z.enum(["email", "scan", "remove"]);
export type IdentifierPurpose = z.infer<typeof IdentifierPurpose>;

/** A rendered message, ready to show in a preview or hand to a mail transport. */
export const RenderedEmail = z.object({
  subject: z.string().min(1),
  text: z.string().min(1),
});
export type RenderedEmail = z.infer<typeof RenderedEmail>;
