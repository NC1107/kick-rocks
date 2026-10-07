import { describe, expect, it } from "vitest";
import { DataSourceId } from "./broker.js";
import {
  DATA_SOURCE_DETAILS,
  ScheduleSettings,
  SETTING_SCHEMAS,
  SettingKey,
  SettingsPatch,
} from "./settings.js";

describe("ScheduleSettings", () => {
  it("defaults to the agreed cadences", () => {
    expect(ScheduleSettings.parse({})).toEqual({
      pollMinutes: 15,
      peopleSearchRescanDays: 60,
      brokerRescanDays: 90,
      noResponseDays: 45,
      maxFollowUps: 2,
    });
  });

  it("rejects nonsense", () => {
    expect(ScheduleSettings.safeParse({ pollMinutes: 0 }).success).toBe(false);
    expect(ScheduleSettings.safeParse({ maxFollowUps: -1 }).success).toBe(false);
    expect(ScheduleSettings.safeParse({ noResponseDays: 1.5 }).success).toBe(false);
  });
});

describe("SETTING_SCHEMAS", () => {
  it("gives every key a default", () => {
    for (const key of SettingKey.options) {
      expect(SETTING_SCHEMAS[key].safeParse(undefined).success, key).toBe(true);
    }
  });

  it("lists the documented keys", () => {
    expect([...SettingKey.options].sort()).toEqual(
      [
        "auth.passwordHash",
        "llm",
        "mcp.enabled",
        "mcp.tokenHash",
        "schedule",
        "worker.status",
        "notifications",
        "notifications.state",
      ].sort(),
    );
  });
});

describe("SettingsPatch", () => {
  it("accepts a partial schedule", () => {
    expect(SettingsPatch.parse({ schedule: { pollMinutes: 30 } })).toEqual({
      schedule: { pollMinutes: 30 },
    });
  });

  it("lets the llm be removed or updated without resending the key", () => {
    expect(SettingsPatch.safeParse({ llm: null }).success).toBe(true);
    expect(
      SettingsPatch.safeParse({ llm: { baseUrl: "http://localhost:11434/v1", model: "llama3" } })
        .success,
    ).toBe(true);
    expect(SettingsPatch.safeParse({ llm: { baseUrl: "not a url", model: "x" } }).success).toBe(
      false,
    );
  });
});

describe("DATA_SOURCE_DETAILS", () => {
  it("describes every data source", () => {
    expect(Object.keys(DATA_SOURCE_DETAILS).sort()).toEqual([...DataSourceId.options].sort());
  });

  it("credits the BADBOOL author", () => {
    expect(DATA_SOURCE_DETAILS.badbool.attribution).toBe("Yael Grauer");
  });
});
