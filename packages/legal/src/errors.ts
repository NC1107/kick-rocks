/** The caller passed something this package cannot act on, such as an email with no follow-up details. */
export class LegalInputError extends Error {
  override name = "LegalInputError";
}
