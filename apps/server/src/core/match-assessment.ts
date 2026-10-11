import { type DbHandle, matches, profiles } from "@kickrocks/db";
import { type Identity, type ScoreProfile, scoreCandidate } from "@kickrocks/shared";
import { and, eq } from "drizzle-orm";
import { loadIdentities } from "./identities.js";

/** Lifetime windows say whether an address is where the person lives now or lived before. */
function isCurrent(identity: Identity, today: string): boolean {
  return (
    (identity.validFrom === null || identity.validFrom <= today) &&
    (identity.validTo === null || identity.validTo >= today)
  );
}

/** The facts of a profile a record is compared with. They stay on the server; only the verdict leaves. */
export function scoreProfileOf(db: DbHandle, profileId: string, today: string): ScoreProfile {
  const identities = loadIdentities(db, profileId);
  const state = db.select().from(profiles).where(eq(profiles.id, profileId)).get()?.state;
  const ofKind = <K extends Identity["kind"]>(kind: K) =>
    identities.filter(
      (identity): identity is Extract<Identity, { kind: K }> => identity.kind === kind,
    );
  const names = [...ofKind("name"), ...ofKind("alias")].sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary),
  );
  const dobs = ofKind("dob");
  const dob = dobs.find((identity) => identity.isPrimary) ?? dobs[0];
  return {
    names: names.map((name) => name.value),
    birth: dob?.value.date ?? null,
    addresses: ofKind("address").map((address) => ({
      city: address.value.city,
      state: address.value.state,
      current: isCurrent(address, today),
    })),
    states: state ? [state] : [],
    phones: ofKind("phone").map((phone) => phone.value.number),
    emails: ofKind("email").map((email) => email.value.address),
  };
}

/** Scores again the records still waiting for a decision, because the profile they are compared with changed. */
export function rescorePendingMatches(db: DbHandle, profileId: string, today: string): void {
  const pending = db
    .select()
    .from(matches)
    .where(and(eq(matches.profileId, profileId), eq(matches.decision, "pending")))
    .all();
  if (pending.length === 0) return;
  const profile = scoreProfileOf(db, profileId, today);
  for (const match of pending) {
    db.update(matches)
      .set({ assessment: scoreCandidate(match.fields, profile, today) })
      .where(eq(matches.id, match.id))
      .run();
  }
}
