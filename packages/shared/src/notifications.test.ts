import { describe, expect, it } from "vitest";
import {
  NotificationSettings,
  NotificationState,
  NotificationsPatch,
  TelegramSettings,
} from "./notifications.js";
import { SETTING_SCHEMAS } from "./settings.js";

describe("NotificationSettings", () => {
  it("defaults to no channels, every category, six pushes an hour, and no digest", () => {
    expect(NotificationSettings.parse({})).toEqual({
      ntfy: null,
      telegram: null,
      categories: ["blocked_task", "verification", "match", "mailbox", "recipe", "worker"],
      maxPerHour: 6,
      digest: { frequency: "off", hourUtc: 8, weekday: 1 },
    });
  });

  it("is what the settings table reads for a key that was never written", () => {
    expect(SETTING_SCHEMAS.notifications.parse(undefined)).toEqual(NotificationSettings.parse({}));
    expect(SETTING_SCHEMAS["notifications.state"].parse(undefined)).toEqual(
      NotificationState.parse({}),
    );
  });
});

describe("TelegramSettings", () => {
  const botToken = "123456789:AAExampleTokenValue_abcdefghijklmnop";

  it.each(["42", "-1001234567", "@kickrocks_alerts"])("accepts chat %s", (chatId) => {
    expect(TelegramSettings.safeParse({ botToken, chatId }).success).toBe(true);
  });

  it.each(["", "chat", "@ab", "1 2"])("rejects chat %j", (chatId) => {
    expect(TelegramSettings.safeParse({ botToken, chatId }).success).toBe(false);
  });
});

describe("NotificationsPatch", () => {
  it("allows a change to one part without naming the rest", () => {
    expect(NotificationsPatch.parse({ digest: { frequency: "daily" } })).toEqual({
      digest: { frequency: "daily" },
    });
  });

  it("does not fill in defaults for what a change leaves out", () => {
    expect(NotificationsPatch.parse({})).toEqual({});
  });
});
