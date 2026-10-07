import {
  IdentifierPurpose,
  needsRecord,
  ProfileField,
  resolveProfileFields,
} from "@kickrocks/shared";
import { z } from "zod";
import { LegalInputError } from "./errors.js";
import type { LegalApi } from "./types.js";

const LOCATION: readonly ProfileField[] = ["city", "state"];

/**
 * What a purpose discloses before anything extra is asked for. Date of birth, street, phone, zip
 * and birth year are never here: only a recipe or an approved broker reply may add them.
 */
function baseFields(
  purpose: IdentifierPurpose,
  target: Parameters<LegalApi["identifiersFor"]>[0],
): readonly ProfileField[] {
  // A site that removes a specific record has to tell the person's listing from a namesake's, so
  // it gets a city and state. A blind request to anyone else gets only a name and an email.
  const locate = needsRecord(target) ? LOCATION : [];
  switch (purpose) {
    case "email":
      return ["full_name", "email", ...locate];
    case "scan":
      return ["first_name", "last_name", ...LOCATION];
    case "remove":
      return ["first_name", "last_name", "full_name", "email", ...locate];
  }
}

const Request = z.object({
  purpose: IdentifierPurpose,
  requestedFields: z.array(ProfileField),
  asOf: z.date().refine((date) => !Number.isNaN(date.getTime()), "asOf is not a valid date"),
});

export const identifiersFor: LegalApi["identifiersFor"] = (
  target,
  identities,
  purpose,
  requestedFields = [],
  asOf = new Date(),
) => {
  const parsed = Request.safeParse({ purpose, requestedFields, asOf });
  if (!parsed.success) {
    throw new LegalInputError(`Cannot choose identifiers: ${z.prettifyError(parsed.error)}`);
  }
  const fields = new Set([
    ...baseFields(parsed.data.purpose, target),
    ...parsed.data.requestedFields,
  ]);
  return resolveProfileFields(identities, [...fields], {
    asOf: parsed.data.asOf.toISOString().slice(0, 10),
  });
};
