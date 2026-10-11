import { createHash } from "node:crypto";
import { scans } from "@kickrocks/db";
import { needsRecord, type ScanVariant } from "@kickrocks/shared";
import { max } from "drizzle-orm";
import { AppError } from "../core/errors.js";
import { identityVariantsFor } from "../core/past-addresses.js";
import { preferenceBlocks } from "../core/scan-preferences.js";
import type { AppServices } from "../services.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A rescan is due in the last quarter of the window, never after it. */
const EARLIEST_SHARE = 0.75;

/**
 * Where in the last quarter of the rescan window one profile's rescan of one site falls. It comes
 * from a hash and not a dice roll, so the answer is the same on every pass and a restart does not
 * move it. Profiles and sites land on different days, so a first campaign that scanned fifty sites
 * on one afternoon does not rescan them all on one afternoon two months later.
 */
export function rescanPosition(profileId: string, siteKey: string): number {
  const digest = createHash("sha256").update(`${profileId}\n${siteKey}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

/** When a pair's next rescan falls, given when it was last scanned and its cadence in days. */
export function nextRescanAt(
  profileId: string,
  siteKey: string,
  lastStartedAt: string,
  rescanDays: number,
): string {
  const share = EARLIEST_SHARE + (1 - EARLIEST_SHARE) * rescanPosition(profileId, siteKey);
  return new Date(Date.parse(lastStartedAt) + rescanDays * DAY_MS * share).toISOString();
}

/**
 * Scans again every people-search target a profile has been scanned on, once its own slot in the
 * last quarter of its window has come since its last scan. The window is the person's choice for
 * that site, else `peopleSearchRescanDays`. A paused or skipped site is left alone, and a pause
 * that has reached its date lets the site back in. A listing that came back is found by the scan,
 * and the scan handler decides what a record that was removed before now means.
 */
export function enqueueDueRescans(services: AppServices): number {
  const { peopleSearchRescanDays } = services.settings.get("schedule");
  const now = services.clock.now().getTime();
  const today = services.clock.now().toISOString().slice(0, 10);
  const last = services.db
    .select({
      profileId: scans.profileId,
      targetId: scans.targetId,
      startedAt: max(scans.startedAt),
    })
    .from(scans)
    .groupBy(scans.profileId, scans.targetId)
    .all();

  let queued = 0;
  for (const pair of last) {
    if (!pair.startedAt) continue;
    const preference = services.scanPreferences.get(pair.profileId, pair.targetId);
    if (preferenceBlocks(preference, today)) continue;
    const siteKey = services.politeness.domainOf(pair.targetId) ?? pair.targetId;
    const days = preference.rescanDays ?? peopleSearchRescanDays;
    if (Date.parse(nextRescanAt(pair.profileId, siteKey, pair.startedAt, days)) > now) continue;
    const target = services.targets.get(pair.targetId);
    if (!target || target.retired || !needsRecord(target)) continue;
    const variants: (ScanVariant | null)[] = [
      null,
      ...(preference.includePastAddresses
        ? identityVariantsFor(services, pair.profileId, today)
        : []),
    ];
    for (const variant of variants) {
      try {
        if (services.dispatch.enqueueScan(pair.profileId, pair.targetId, variant).created) {
          queued += 1;
        }
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        services.logger.info(
          { profileId: pair.profileId, targetId: pair.targetId, code: error.code },
          "skipped a re-scan",
        );
      }
    }
  }
  return queued;
}
