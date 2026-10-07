import { type KickRocksDb, sessions } from "@kickrocks/db";
import type { Clock } from "./core/clock.js";
import { createSettingsStore } from "./core/settings.js";

/**
 * Forgets the password and every signed-in session, so the next visit asks for a new password
 * exactly as on a fresh install. It needs access to the data directory, which is the proof that the
 * person owns the machine; nothing is exposed over HTTP. Profiles, requests, and the mailbox stay.
 */
export function resetPassword(db: KickRocksDb, clock: Clock): void {
  const settings = createSettingsStore(db, clock);
  db.transaction(() => {
    settings.reset("auth.passwordHash");
    db.delete(sessions).run();
  });
}
