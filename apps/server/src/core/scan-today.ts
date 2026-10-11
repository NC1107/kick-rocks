import { dateIn } from "@kickrocks/shared";
import type { Clock } from "./clock.js";
import type { SettingsStore } from "./settings.js";

/**
 * Today as the person lives it. A pause ends on the date they picked on their own calendar, and
 * not when UTC midnight falls on the evening before.
 */
export function scanToday(deps: { clock: Clock; settings: Pick<SettingsStore, "get"> }): string {
  return dateIn(deps.clock.now(), deps.settings.get("scanning").timeZone);
}
