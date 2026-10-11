import { type DbHandle, matches, profiles, scans } from "@kickrocks/db";
import { type Identity, type ScoreProfile, scoreCandidate } from "@kickrocks/shared";
import { and, eq, isNull } from "drizzle-orm";
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

/** The day a record was read off its page, which is the day its age and addresses are judged on. */
export function scoredOn(scan: { finishedAt: string | null; startedAt: string }): string {
  return (scan.finishedAt ?? scan.startedAt).slice(0, 10);
}

/**
 * Scores again the records still waiting for a decision, because the profile they are compared
 * with changed. Each is judged as of its own scan day, so a later rescore never ages a record.
 */
export function rescorePendingMatches(
  db: DbHandle,
  profileId: string,
  only: "all" | "unscored" = "all",
): void {
  const pending = db
    .select({ match: matches, scan: scans })
    .from(matches)
    .innerJoin(scans, eq(scans.id, matches.scanId))
    .where(and(eq(matches.profileId, profileId), eq(matches.decision, "pending")))
    .all()
    .filter(({ match }) => only === "all" || match.assessment === null);
  const profiles = new Map<string, ScoreProfile>();
  for (const { match, scan } of pending) {
    const day = scoredOn(scan);
    const profile = profiles.get(day) ?? scoreProfileOf(db, profileId, day);
    profiles.set(day, profile);
    db.update(matches)
      .set({ assessment: scoreCandidate(match.fields, profile, day) })
      .where(eq(matches.id, match.id))
      .run();
  }
}

/** Records stored before scoring existed have no assessment, so the queue would show them bare. */
export function scoreUnscoredMatches(db: DbHandle): void {
  const waiting = db
    .select({ profileId: matches.profileId })
    .from(matches)
    .where(and(eq(matches.decision, "pending"), isNull(matches.assessment)))
    .all();
  for (const profileId of new Set(waiting.map((row) => row.profileId)))
    rescorePendingMatches(db, profileId, "unscored");
}
