import { z } from "zod";
import { StateCode } from "./geography.js";

export const IdentityKind = z.enum(["name", "alias", "email", "phone", "address", "dob"]);
export type IdentityKind = z.infer<typeof IdentityKind>;

const text = (max: number) => z.string().trim().min(1).max(max);

export const PersonName = z.object({
  first: text(60),
  middle: text(60).optional(),
  last: text(60),
});
export type PersonName = z.infer<typeof PersonName>;

export const EmailValue = z.object({ address: z.email().max(254) });
export type EmailValue = z.infer<typeof EmailValue>;

export const PhoneValue = z.object({
  number: z.string().regex(/^\+[1-9]\d{6,14}$/, "Use E.164 format, for example +15555550123"),
});
export type PhoneValue = z.infer<typeof PhoneValue>;

export const AddressValue = z.object({
  street: text(120),
  unit: text(40).optional(),
  city: text(80),
  state: StateCode,
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, "Use a 5 digit ZIP or ZIP+4"),
});
export type AddressValue = z.infer<typeof AddressValue>;

export const DobValue = z.object({ date: z.iso.date() });
export type DobValue = z.infer<typeof DobValue>;

const lifetime = {
  isPrimary: z.boolean().default(false),
  validFrom: z.iso.date().nullable().default(null),
  validTo: z.iso.date().nullable().default(null),
};

function identityVariants<Extra extends z.ZodRawShape>(extra: Extra) {
  return [
    z.object({ ...extra, kind: z.literal("name"), value: PersonName, ...lifetime }),
    z.object({ ...extra, kind: z.literal("alias"), value: PersonName, ...lifetime }),
    z.object({ ...extra, kind: z.literal("email"), value: EmailValue, ...lifetime }),
    z.object({ ...extra, kind: z.literal("phone"), value: PhoneValue, ...lifetime }),
    z.object({ ...extra, kind: z.literal("address"), value: AddressValue, ...lifetime }),
    z.object({ ...extra, kind: z.literal("dob"), value: DobValue, ...lifetime }),
  ] as const;
}

/** A stored identity: one fact about a person, validated by its kind. */
export const Identity = z.discriminatedUnion("kind", identityVariants({ id: z.string().min(1) }));
export type Identity = z.infer<typeof Identity>;

/** An identity as submitted by a client; the server assigns the id. */
export const IdentityInput = z.discriminatedUnion("kind", identityVariants({}));
export type IdentityInput = z.infer<typeof IdentityInput>;

export type IdentityOfKind<K extends IdentityKind> = Extract<Identity, { kind: K }>;

export interface IdentityIssue {
  path: (string | number)[];
  message: string;
}

const EARLIEST_DOB = "1900-01-01";

/**
 * Cross-identity rules a single-value schema cannot express.
 * Resolution picks one primary per kind, so more than one would be ambiguous.
 */
export function validateIdentities(
  identities: readonly Pick<
    IdentityInput,
    "kind" | "value" | "isPrimary" | "validFrom" | "validTo"
  >[],
  today: string,
): IdentityIssue[] {
  const issues: IdentityIssue[] = [];
  const primaryByKind = new Map<IdentityKind, number>();

  identities.forEach((identity, index) => {
    if (identity.isPrimary) {
      primaryByKind.set(identity.kind, (primaryByKind.get(identity.kind) ?? 0) + 1);
    }
    if (identity.validFrom && identity.validTo && identity.validFrom > identity.validTo) {
      issues.push({ path: [index, "validTo"], message: "Must not be before the start date" });
    }
    if (identity.kind === "dob") {
      const date = (identity.value as DobValue).date;
      if (date < EARLIEST_DOB || date > today) {
        issues.push({ path: [index, "value", "date"], message: "Date of birth is not plausible" });
      }
    }
  });

  if ((primaryByKind.get("name") ?? 0) === 0) {
    issues.push({ path: [], message: "Exactly one primary name is required" });
  }
  for (const [kind, count] of primaryByKind) {
    if (count > 1) issues.push({ path: [], message: `Only one primary ${kind} is allowed` });
  }
  if (!identities.some((i) => i.kind === "email")) {
    issues.push({ path: [], message: "At least one email is required" });
  }
  return issues;
}

/** The full set of identities for a profile, replaced as a unit. */
export const IdentityInputList = z
  .array(IdentityInput)
  .max(60)
  .superRefine((identities, ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    for (const issue of validateIdentities(identities, today)) {
      ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
  });
export type IdentityInputList = z.infer<typeof IdentityInputList>;

/** Profile fields a recipe may ask for. Each recipe declares the subset it needs. */
export const ProfileField = z.enum([
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "city",
  "state",
  "zip",
  "street",
  "birth_year",
  "date_of_birth",
  "record_url",
]);
export type ProfileField = z.infer<typeof ProfileField>;

export type ProfileFields = Partial<Record<ProfileField, string>>;

export function formatFullName(name: PersonName): string {
  return [name.first, name.middle, name.last].filter(Boolean).join(" ");
}

function isValidOn(identity: Pick<Identity, "validFrom" | "validTo">, date: string): boolean {
  if (identity.validFrom && identity.validFrom > date) return false;
  if (identity.validTo && identity.validTo < date) return false;
  return true;
}

/** The identity of a kind in force on a date: the primary one, else the first that is valid. */
export function currentIdentity<K extends IdentityKind>(
  identities: readonly Identity[],
  kind: K,
  asOf: string,
): IdentityOfKind<K> | null {
  const valid = identities.filter(
    (i): i is IdentityOfKind<K> => i.kind === kind && isValidOn(i, asOf),
  );
  return valid.find((i) => i.isPrimary) ?? valid[0] ?? null;
}

export interface ResolveFieldsContext {
  /** Date the values must be valid on, as YYYY-MM-DD. */
  asOf: string;
  recordUrl?: string | null;
}

/**
 * Turns identities into the values a recipe or agent asked for.
 * Fields with no matching identity are omitted rather than blanked, so a caller can tell the
 * difference between "not requested" and "not available".
 */
export function resolveProfileFields(
  identities: readonly Identity[],
  fields: readonly ProfileField[],
  context: ResolveFieldsContext,
): ProfileFields {
  const name = currentIdentity(identities, "name", context.asOf)?.value;
  const email = currentIdentity(identities, "email", context.asOf)?.value;
  const phone = currentIdentity(identities, "phone", context.asOf)?.value;
  const address = currentIdentity(identities, "address", context.asOf)?.value;
  const dob = currentIdentity(identities, "dob", context.asOf)?.value;

  const candidates: Record<ProfileField, string | undefined> = {
    first_name: name?.first,
    last_name: name?.last,
    full_name: name ? formatFullName(name) : undefined,
    email: email?.address,
    phone: phone?.number,
    city: address?.city,
    state: address?.state,
    zip: address?.zip,
    street: address ? [address.street, address.unit].filter(Boolean).join(" ") : undefined,
    birth_year: dob?.date.slice(0, 4),
    date_of_birth: dob?.date,
    record_url: context.recordUrl ?? undefined,
  };

  const resolved: ProfileFields = {};
  for (const field of fields) {
    const value = candidates[field];
    if (value !== undefined) resolved[field] = value;
  }
  return resolved;
}
