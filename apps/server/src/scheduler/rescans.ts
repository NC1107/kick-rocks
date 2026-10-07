import { scans } from "@kickrocks/db";
import { needsRecord } from "@kickrocks/shared";
import { max } from "drizzle-orm";
import { AppError } from "../core/errors.js";
import type { AppServices } from "../services.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Scans again every people-search target a profile has been scanned on, once
 * `peopleSearchRescanDays` have passed since its last scan. A listing that came back is found by
 * the scan, and the scan handler decides what a record that was removed before now means.
 */
export function enqueueDueRescans(services: AppServices): number {
  const { peopleSearchRescanDays } = services.settings.get("schedule");
  const now = services.clock.now().getTime();
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
    if (!pair.startedAt || Date.parse(pair.startedAt) + peopleSearchRescanDays * DAY_MS > now) {
      continue;
    }
    const target = services.targets.get(pair.targetId);
    if (!target || target.retired || !needsRecord(target)) continue;
    try {
      if (services.dispatch.enqueueScan(pair.profileId, pair.targetId).created) queued += 1;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      services.logger.info(
        { profileId: pair.profileId, targetId: pair.targetId, code: error.code },
        "skipped a re-scan",
      );
    }
  }
  return queued;
}
