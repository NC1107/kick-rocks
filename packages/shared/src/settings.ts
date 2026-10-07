import { z } from "zod";
import { DataSourceId } from "./broker.js";
import { NotificationSettings, NotificationState } from "./notifications.js";
import { WebUrl } from "./url.js";

const pollMinutes = z.number().int().min(1).max(1440);
const rescanDays = z.number().int().min(1).max(365);
const maxFollowUps = z.number().int().min(0).max(10);

export const ScheduleSettings = z.object({
  /** Minutes between inbox polls. */
  pollMinutes: pollMinutes.default(15),
  peopleSearchRescanDays: rescanDays.default(60),
  brokerRescanDays: rescanDays.default(90),
  /** Days to wait for any reply before a request counts as unanswered. */
  noResponseDays: rescanDays.default(45),
  maxFollowUps: maxFollowUps.default(2),
});
export type ScheduleSettings = z.infer<typeof ScheduleSettings>;

/** A change to the schedule. Unlike ScheduleSettings it has no defaults, so it never resets a field it omits. */
export const SchedulePatch = z.object({
  pollMinutes: pollMinutes.optional(),
  peopleSearchRescanDays: rescanDays.optional(),
  brokerRescanDays: rescanDays.optional(),
  noResponseDays: rescanDays.optional(),
  maxFollowUps: maxFollowUps.optional(),
});
export type SchedulePatch = z.infer<typeof SchedulePatch>;

const retentionDays = z.number().int().min(1).max(3650);

/**
 * How long Kick Rocks keeps the bulky and sensitive parts of what it stores. Null keeps them
 * until the person deletes them. Message text is the body, snippet, links, and classifier note of
 * mail already dealt with; the sender, subject, and outcome stay so a request keeps its history.
 */
export const RetentionSettings = z.object({
  messageDays: retentionDays.nullable().default(null),
  screenshotDays: retentionDays.nullable().default(30),
});
export type RetentionSettings = z.infer<typeof RetentionSettings>;

export const RetentionPatch = z.object({
  messageDays: retentionDays.nullable().optional(),
  screenshotDays: retentionDays.nullable().optional(),
});
export type RetentionPatch = z.infer<typeof RetentionPatch>;

/** Any OpenAI-compatible endpoint, such as Ollama, used to classify mail the rules cannot. */
export const LlmSettings = z.object({
  baseUrl: WebUrl,
  model: z.string().min(1),
  apiKey: z.string().nullable(),
});
export type LlmSettings = z.infer<typeof LlmSettings>;

/** The LLM settings as shown to the client, which never receives the key. */
export const LlmSettingsView = z.object({
  baseUrl: WebUrl,
  model: z.string(),
  apiKeySet: z.boolean(),
});
export type LlmSettingsView = z.infer<typeof LlmSettingsView>;

export const WorkerStatus = z.object({
  workerId: z.string(),
  version: z.string().nullable(),
  lastSeenAt: z.iso.datetime(),
  busy: z.boolean(),
  currentTaskId: z.string().nullable(),
});
export type WorkerStatus = z.infer<typeof WorkerStatus>;

/** Every key in the settings table with the schema of its value. */
export const SETTING_SCHEMAS = {
  "auth.passwordHash": z.string().nullable().default(null),
  "mcp.tokenHash": z.string().nullable().default(null),
  "mcp.enabled": z.boolean().default(false),
  schedule: ScheduleSettings.default(ScheduleSettings.parse({})),
  llm: LlmSettings.nullable().default(null),
  retention: RetentionSettings.default(RetentionSettings.parse({})),
  "worker.status.builtin": WorkerStatus.nullable().default(null),
  "worker.status.model": WorkerStatus.nullable().default(null),
  notifications: NotificationSettings.default(NotificationSettings.parse({})),
  "notifications.state": NotificationState.default(NotificationState.parse({})),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;
export const SettingKey = z.enum(Object.keys(SETTING_SCHEMAS) as [SettingKey, ...SettingKey[]]);

export const SettingsView = z.object({
  schedule: ScheduleSettings,
  llm: LlmSettingsView.nullable(),
  retention: RetentionSettings,
  mcp: z.object({
    enabled: z.boolean(),
    tokenSet: z.boolean(),
    /** Where an MCP client connects, built from KICKROCKS_PUBLIC_URL. */
    url: WebUrl,
  }),
  worker: z.object({
    /** False when KICKROCKS_WORKER_TOKEN is unset and the worker API is switched off. */
    enabled: z.boolean(),
    /** The worker that runs recipes. It and the model worker report separately. */
    builtin: WorkerStatus.nullable(),
    /** The worker that drives a model for the sites no recipe covers. */
    model: WorkerStatus.nullable(),
  }),
});
export type SettingsView = z.infer<typeof SettingsView>;

export const SettingsPatch = z.object({
  schedule: SchedulePatch.optional(),
  retention: RetentionPatch.optional(),
  /** Null removes the LLM; an omitted apiKey keeps the stored one. */
  llm: z
    .object({
      baseUrl: WebUrl,
      model: z.string().min(1),
      apiKey: z.string().min(1).nullable().optional(),
    })
    .nullable()
    .optional(),
  mcp: z.object({ enabled: z.boolean() }).optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export const DataSourceInfo = z.object({
  id: DataSourceId,
  name: z.string(),
  url: WebUrl,
  license: z.string(),
  attribution: z.string().nullable(),
  /** Targets currently carrying this source. */
  targetCount: z.number().int().nonnegative(),
});
export type DataSourceInfo = z.infer<typeof DataSourceInfo>;

/** Static facts about each upstream source; the counts are filled in from the database. */
export const DATA_SOURCE_DETAILS: Record<
  DataSourceId,
  Omit<DataSourceInfo, "id" | "targetCount">
> = {
  eraser: {
    name: "Eraser broker list",
    url: "https://github.com/drumandbytes/eraser",
    license: "MIT",
    attribution: null,
  },
  "ca-registry-2025": {
    name: "California Data Broker Registry 2025",
    url: "https://cppa.ca.gov/data_broker_registry/",
    license: "Public record",
    attribution: null,
  },
  badbool: {
    name: "Big Ass Data Broker Opt-Out List",
    url: "https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List",
    license: "CC BY-NC-SA 4.0",
    attribution: "Yael Grauer",
  },
  kickrocks: {
    name: "Kick Rocks broker data",
    url: "https://github.com/NC1107/kick-rocks",
    license: "PolyForm Noncommercial 1.0.0",
    attribution: null,
  },
  "kickrocks-companies": {
    name: "Kick Rocks company list",
    url: "https://github.com/NC1107/kick-rocks",
    license: "PolyForm Noncommercial 1.0.0",
    attribution: null,
  },
};
