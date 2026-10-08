import { z } from "zod";
import { WebUrl } from "./url.js";

/** What can make Kick Rocks send a push notification. */
export const NotificationCategory = z.enum([
  "blocked_task",
  "verification",
  "match",
  "mailbox",
  "recipe",
  "worker",
]);
export type NotificationCategory = z.infer<typeof NotificationCategory>;

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  blocked_task: "A task is blocked and needs you",
  verification: "A broker asks for identifiers you must approve",
  match: "A listing needs your decision",
  mailbox: "Your mailbox fails",
  recipe: "A recipe breaks",
  worker: "The worker is offline while work waits",
};

const ntfyTopic = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "Use letters, digits, dashes and underscores");
const telegramBotToken = z
  .string()
  .regex(/^\d{3,20}:[A-Za-z0-9_-]{20,100}$/, "That does not look like a bot token");
const telegramChatId = z
  .string()
  .regex(
    /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/,
    "Use the numeric chat id or an @channel name",
  );

export const NtfySettings = z.object({
  /** https://ntfy.sh or a self-hosted server. */
  serverUrl: WebUrl,
  topic: ntfyTopic,
  /** Only needed for a topic that requires a login. */
  token: z.string().min(1).nullable(),
});
export type NtfySettings = z.infer<typeof NtfySettings>;

export const TelegramSettings = z.object({
  botToken: telegramBotToken,
  chatId: telegramChatId,
});
export type TelegramSettings = z.infer<typeof TelegramSettings>;

export const DigestFrequency = z.enum(["off", "daily", "weekly"]);
export type DigestFrequency = z.infer<typeof DigestFrequency>;

export const DigestSettings = z.object({
  frequency: DigestFrequency.default("off"),
  /** Hour of the day in UTC. */
  hourUtc: z.number().int().min(0).max(23).default(8),
  /** 0 is Sunday. Only a weekly digest reads it. */
  weekday: z.number().int().min(0).max(6).default(1),
});
export type DigestSettings = z.infer<typeof DigestSettings>;

export const NotificationSettings = z.object({
  ntfy: NtfySettings.nullable().default(null),
  telegram: TelegramSettings.nullable().default(null),
  categories: z.array(NotificationCategory).default([...NotificationCategory.options]),
  /** Pushes allowed per hour. Items that would exceed it wait and go out in the next message. */
  maxPerHour: z.number().int().min(1).max(60).default(6),
  digest: DigestSettings.default(DigestSettings.parse({})),
});
export type NotificationSettings = z.infer<typeof NotificationSettings>;

/** What the server remembers between passes. It reaches the client only as `status`. */
export const PushChannel = z.enum(["ntfy", "telegram"]);
export type PushChannel = z.infer<typeof PushChannel>;

export const NotificationState = z.object({
  /** Per channel, keys of the items it accepted and that are still open, so each is announced once. */
  announced: z
    .object({
      ntfy: z.array(z.string()).default([]),
      telegram: z.array(z.string()).default([]),
    })
    .default({ ntfy: [], telegram: [] }),
  /** When an announced item stopped being open, so one that flaps is not announced again at once. */
  resolvedAt: z.record(z.string(), z.iso.datetime()).default({}),
  sentAt: z.array(z.iso.datetime()).default([]),
  lastSentAt: z.iso.datetime().nullable().default(null),
  lastError: z.string().nullable().default(null),
  /** Per channel, so one that is down does not hold back the other. */
  retryAfter: z
    .object({
      ntfy: z.iso.datetime().nullable().default(null),
      telegram: z.iso.datetime().nullable().default(null),
    })
    .default({ ntfy: null, telegram: null }),
  digestLastSentAt: z.iso.datetime().nullable().default(null),
  digestLastError: z.string().nullable().default(null),
  digestRetryAfter: z.iso.datetime().nullable().default(null),
});
export type NotificationState = z.infer<typeof NotificationState>;

export const NotificationsView = z.object({
  ntfy: z.object({ serverUrl: WebUrl, topic: z.string(), tokenSet: z.boolean() }).nullable(),
  telegram: z.object({ chatId: z.string(), botTokenSet: z.boolean() }).nullable(),
  categories: z.array(NotificationCategory),
  maxPerHour: z.number().int(),
  digest: DigestSettings,
  /** Where the links in a notification lead. */
  appUrl: WebUrl,
  /** Whether a mailbox exists to send the digest from. */
  mailboxReady: z.boolean(),
  status: z.object({
    lastSentAt: z.iso.datetime().nullable(),
    lastError: z.string().nullable(),
    digestLastSentAt: z.iso.datetime().nullable(),
    digestLastError: z.string().nullable(),
  }),
});
export type NotificationsView = z.infer<typeof NotificationsView>;

export const NotificationsPatch = z.object({
  /** Null removes ntfy; an omitted token keeps the stored one and null clears it. */
  ntfy: z
    .object({
      serverUrl: WebUrl,
      topic: ntfyTopic,
      token: z.string().min(1).nullable().optional(),
    })
    .nullable()
    .optional(),
  /** Null removes Telegram; an omitted bot token keeps the stored one. */
  telegram: z
    .object({ botToken: telegramBotToken.optional(), chatId: telegramChatId })
    .nullable()
    .optional(),
  categories: z.array(NotificationCategory).optional(),
  maxPerHour: NotificationSettings.shape.maxPerHour.unwrap().optional(),
  digest: z
    .object({
      frequency: DigestFrequency.optional(),
      hourUtc: DigestSettings.shape.hourUtc.unwrap().optional(),
      weekday: DigestSettings.shape.weekday.unwrap().optional(),
    })
    .optional(),
});
export type NotificationsPatch = z.infer<typeof NotificationsPatch>;

export const NotificationChannel = z.enum(["ntfy", "telegram"]);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

export const NotificationTestBody = z.object({ channel: NotificationChannel });
export type NotificationTestBody = z.infer<typeof NotificationTestBody>;

export const NotificationTestResult = z.object({
  ok: z.boolean(),
  /** Why the channel did not accept the message, never containing a token. */
  error: z.string().nullable(),
});
export type NotificationTestResult = z.infer<typeof NotificationTestResult>;

export const DigestSendOutcome = z.enum(["sent", "nothing_to_report", "no_mailbox", "failed"]);
export type DigestSendOutcome = z.infer<typeof DigestSendOutcome>;

export const DigestSendResult = z.object({
  outcome: DigestSendOutcome,
  /** Digests that went out, one per mailbox. */
  sent: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type DigestSendResult = z.infer<typeof DigestSendResult>;
