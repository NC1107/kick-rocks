import { type KickRocksDb, recipes } from "@kickrocks/db";
import { type ProfileField, Recipe, resolveProfileFields } from "@kickrocks/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Clock } from "./clock.js";
import { loadIdentities } from "./identities.js";

/** What an agent needs to search a people-search site when no recipe will run the scan. */
const AGENT_SCAN_FIELDS: readonly ProfileField[] = ["full_name", "state"];

/** Fields a recipe types that come from somewhere other than the profile's identities. */
const NOT_FROM_IDENTITIES: readonly ProfileField[] = ["email", "record_url"];

const ADDRESS_FIELDS: readonly ProfileField[] = ["city", "state", "zip", "street"];
const NAME_FIELDS: readonly ProfileField[] = ["first_name", "last_name", "full_name"];

const FIELD_WORDS: Partial<Record<ProfileField, string>> = {
  first_name: "first name",
  last_name: "last name",
  full_name: "name",
  city: "city",
  state: "state",
  zip: "ZIP code",
  street: "street",
  phone: "phone number",
  birth_year: "date of birth",
  date_of_birth: "date of birth",
};

/**
 * The profile details a scan of this target would need and the profile does not have. A scan
 * searches by name and place, and a site that is searched without them fails after the browser has
 * already been opened, so the person is told before anything starts.
 */
export function missingScanFields(
  { db, clock }: { db: KickRocksDb; clock: Clock },
  profileId: string,
  targetId: string,
): ProfileField[] {
  const rows = db
    .select({ definition: recipes.definition, health: recipes.health })
    .from(recipes)
    .where(
      and(
        eq(recipes.targetId, targetId),
        eq(recipes.purpose, "scan"),
        eq(recipes.status, "active"),
      ),
    )
    .orderBy(desc(recipes.version))
    .all();
  const usable = rows.find((row) => row.health !== "broken");
  const wanted = usable
    ? Recipe.parse(usable.definition).fields.filter((field) => !NOT_FROM_IDENTITIES.includes(field))
    : AGENT_SCAN_FIELDS;
  const resolved = resolveProfileFields(loadIdentities(db, profileId), wanted, {
    asOf: clock.now().toISOString().slice(0, 10),
    nameId: null,
    addressId: null,
  });
  return wanted.filter((field) => resolved[field] === undefined);
}

/** The sentence that says what to add to the profile, in the profile's terms rather than field names. */
export function describeMissingScanFields(missing: readonly ProfileField[]): string {
  const address = missing.filter((field) => ADDRESS_FIELDS.includes(field));
  const name = missing.some((field) => NAME_FIELDS.includes(field));
  const parts = [
    ...(name ? ["a current name"] : []),
    ...(address.length > 0
      ? [`a current address with ${address.map((field) => FIELD_WORDS[field]).join(" and ")}`]
      : []),
    ...missing
      .filter((field) => !ADDRESS_FIELDS.includes(field) && !NAME_FIELDS.includes(field))
      .map((field) => `a ${FIELD_WORDS[field] ?? field}`),
  ];
  return parts.join(" and ");
}
