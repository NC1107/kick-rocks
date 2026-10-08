import { describe, expect, it } from "vitest";
import { DataSourceId } from "./broker.js";
import {
  DATA_SOURCE_DETAILS,
  RetentionSettings,
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

describe("RetentionSettings", () => {
  it("keeps screenshots 30 days and messages forever until told otherwise", () => {
    expect(RetentionSettings.parse({})).toEqual({ messageDays: null, screenshotDays: 30 });
  });

  it("takes a whole number of days or null, and nothing else", () => {
    expect(RetentionSettings.safeParse({ messageDays: 90, screenshotDays: null }).success).toBe(
      true,
    );
    for (const bad of [0, -1, 1.5, 3651, "7"]) {
      expect(RetentionSettings.safeParse({ messageDays: bad }).success, String(bad)).toBe(false);
    }
  });

  it("is patched one field at a time", () => {
    expect(SettingsPatch.parse({ retention: { screenshotDays: null } })).toEqual({
      retention: { screenshotDays: null },
    });
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
        "retention",
        "schedule",
        "scanning",
        "egress",
        "siteChecks.enabled",
        "agent.takeUnreviewed",
        "worker.status.builtin",
        "worker.status.model",
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
