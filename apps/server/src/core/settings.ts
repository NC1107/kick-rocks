import { type KickRocksDb, settings } from "@kickrocks/db";
import { SETTING_SCHEMAS, type SettingKey, type SettingValue } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { type Clock, nowIso } from "./clock.js";

/** Typed access to the settings table. A key that was never written reads as its default. */
export interface SettingsStore {
  get<K extends SettingKey>(key: K): SettingValue<K>;
  set<K extends SettingKey>(key: K, value: SettingValue<K>): void;
  /** Removes the stored value so the key reads as its default again. */
  reset(key: SettingKey): void;
}

export function createSettingsStore(db: KickRocksDb, clock: Clock): SettingsStore {
  return {
    get(key) {
      const row = db.select().from(settings).where(eq(settings.key, key)).get();
      return SETTING_SCHEMAS[key].parse(row?.value) as SettingValue<typeof key>;
    },

    set(key, value) {
      const parsed = SETTING_SCHEMAS[key].parse(value);
      const updatedAt = nowIso(clock);
      db.insert(settings)
        .values({ key, value: parsed, updatedAt })
        .onConflictDoUpdate({ target: settings.key, set: { value: parsed, updatedAt } })
        .run();
    },

    reset(key) {
      db.delete(settings).where(eq(settings.key, key)).run();
    },
  };
}
