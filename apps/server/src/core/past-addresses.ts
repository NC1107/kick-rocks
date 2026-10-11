import type { KickRocksDb } from "@kickrocks/db";
import type { ScanVariant } from "@kickrocks/shared";
import { loadIdentities } from "./identities.js";

/**
 * One scan variant per address the profile no longer lives at. A listing is often keyed by an old
 * address, and each one is a separate visit to the site, so the caller opts in to them.
 */
export function identityVariantsFor(
  { db }: { db: KickRocksDb },
  profileId: string,
  today: string,
): ScanVariant[] {
  return loadIdentities(db, profileId)
    .filter(
      (identity) =>
        identity.kind === "address" && identity.validTo !== null && identity.validTo < today,
    )
    .map((identity) => ({ nameId: null, addressId: identity.id }));
}
