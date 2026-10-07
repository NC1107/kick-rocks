import { type KickRocksDb, profiles } from "@kickrocks/db";
import { eq } from "drizzle-orm";
import { notFound } from "./errors.js";

export function requireProfile(db: KickRocksDb, profileId: string): void {
  const found = db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .get();
  if (!found) throw notFound(`Profile ${profileId} not found`, "profile_not_found");
}
