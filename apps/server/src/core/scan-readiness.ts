import { type KickRocksDb, recipes, targets } from "@kickrocks/db";
import {
  type ProfileField,
  Recipe,
  resolveProfileFields,
  type ScanReadiness,
} from "@kickrocks/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Clock } from "./clock.js";
import { loadIdentities } from "./identities.js";
import { isPeopleSearchTarget } from "./targets.js";

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
  const usable = usableScanRecipe(db, targetId);
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

/** The newest approved scan recipe that is not known to be broken, which is what the built-in worker would run. */
function usableScanRecipe(db: KickRocksDb, targetId: string) {
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
  return rows.find((row) => row.health !== "broken");
}

/** Whether a scan of this site has no recipe to run, so only a connected agent can do it. */
export function scanNeedsAgent(db: KickRocksDb, targetId: string): boolean {
  return usableScanRecipe(db, targetId) === undefined;
}

/** How many people-search sites a profile can be scanned on right now, and what the rest are missing. */
export function profileScanReadiness(
  services: { db: KickRocksDb; clock: Clock },
  profileId: string,
): ScanReadiness {
  const sites = services.db
    .select({ id: targets.id, kind: targets.kind, category: targets.category })
    .from(targets)
    .where(eq(targets.retired, false))
    .all()
    .filter(isPeopleSearchTarget);
  const missing = new Set<ProfileField>();
  let needsDetails = 0;
  let needsAgent = 0;
  for (const site of sites) {
    const lacking = missingScanFields(services, profileId, site.id);
    if (lacking.length > 0) {
      needsDetails += 1;
      for (const field of lacking) missing.add(field);
    } else if (scanNeedsAgent(services.db, site.id)) {
      needsAgent += 1;
    }
  }
  return {
    ready: sites.length - needsDetails - needsAgent,
    needsAgent,
    needsDetails,
    missing: missing.size > 0 ? describeMissingScanFields([...missing]) : null,
  };
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
