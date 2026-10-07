import { type DbHandle, identities } from "@kickrocks/db";
import { Identity } from "@kickrocks/shared";
import { asc, eq, sql } from "drizzle-orm";

/** A profile's identities in the order they were saved. Rows are re-validated as they are read. */
export function loadIdentities(db: DbHandle, profileId: string): Identity[] {
  return db
    .select()
    .from(identities)
    .where(eq(identities.profileId, profileId))
    .orderBy(asc(sql`rowid`))
    .all()
    .map((row) =>
      Identity.parse({
        id: row.id,
        kind: row.kind,
        value: row.value,
        isPrimary: row.isPrimary,
        validFrom: row.validFrom,
        validTo: row.validTo,
      }),
    );
}
