import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type RecipeStep,
  type RetentionPatch,
  type RetentionSettings,
  type SchedulePatch,
  type ScheduleSettings,
  WebUrl,
} from "@kickrocks/shared";

export interface ScheduleField {
  key: keyof ScheduleSettings;
  label: string;
  help: string;
  unit: string;
  min: number;
  max: number;
}

export const SCHEDULE_FIELDS: readonly ScheduleField[] = [
  {
    key: "pollMinutes",
    label: "Check the inbox every",
    help: "How often Kick Rocks looks for replies.",
    unit: "minutes",
    min: 1,
    max: 1440,
  },
  {
    key: "noResponseDays",
    label: "Wait for a reply for",
    help: "After this long without an answer, a request counts as unanswered.",
    unit: "days",
    min: 1,
    max: 365,
  },
  {
    key: "maxFollowUps",
    label: "Follow up at most",
    help: "How many reminders to send a target that stays silent. Zero turns them off.",
    unit: "times",
    min: 0,
    max: 10,
  },
  {
    key: "peopleSearchRescanDays",
    label: "Re-scan people-search sites every",
    help: "Listings come back, so Kick Rocks looks again on this schedule.",
    unit: "days",
    min: 1,
    max: 365,
  },
  {
    key: "brokerRescanDays",
    label: "Re-send unconfirmed broker requests every",
    help: "Applies to brokers that never confirmed a removal.",
    unit: "days",
    min: 1,
    max: 365,
  },
];

export type ScheduleDraft = Record<keyof ScheduleSettings, string>;

export function draftOf(schedule: ScheduleSettings): ScheduleDraft {
  return {
    pollMinutes: String(schedule.pollMinutes),
    peopleSearchRescanDays: String(schedule.peopleSearchRescanDays),
    brokerRescanDays: String(schedule.brokerRescanDays),
    noResponseDays: String(schedule.noResponseDays),
    maxFollowUps: String(schedule.maxFollowUps),
  };
}

export interface ScheduleCheck {
  errors: Partial<Record<keyof ScheduleSettings, string>>;
  /** Only the fields that differ from what is saved, so a save never resets one it did not touch. */
  patch: SchedulePatch;
}

export function checkSchedule(draft: ScheduleDraft, saved: ScheduleSettings): ScheduleCheck {
  const errors: ScheduleCheck["errors"] = {};
  const patch: SchedulePatch = {};
  for (const field of SCHEDULE_FIELDS) {
    const text = draft[field.key].trim();
    const value = Number(text);
    if (text === "" || !Number.isInteger(value)) {
      errors[field.key] = "Enter a whole number.";
    } else if (value < field.min || value > field.max) {
      errors[field.key] = `Enter ${field.min} to ${field.max}.`;
    } else if (value !== saved[field.key]) {
      patch[field.key] = value;
    }
  }
  return { errors, patch };
}

export interface LlmDraft {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function checkLlm(draft: LlmDraft): Partial<Record<keyof LlmDraft, string>> {
  const errors: Partial<Record<keyof LlmDraft, string>> = {};
  if (!WebUrl.safeParse(draft.baseUrl.trim()).success) {
    errors.baseUrl = "Enter a web address that starts with http:// or https://.";
  }
  if (draft.model.trim() === "") errors.model = "Enter the model name.";
  return errors;
}

const WORKER_ONLINE_MS = 2 * 60_000;

export type WorkerState = "online" | "offline" | "never";

export function workerState(lastSeenAt: string | null, now: number): WorkerState {
  if (lastSeenAt === null) return "never";
  return now - new Date(lastSeenAt).getTime() <= WORKER_ONLINE_MS ? "online" : "offline";
}

/** The command that registers Kick Rocks with Claude Code. The token is shown only when it was just made. */
export function claudeCodeCommand(url: string, token: string | null): string {
  return `claude mcp add --transport http kickrocks ${url} --header "Authorization: Bearer ${token ?? "<your-token>"}"`;
}

function describeLocator(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const locator = value as Record<string, unknown>;
  for (const key of ["label", "text", "testId", "css", "role"]) {
    const found = locator[key];
    if (typeof found === "string") return found;
  }
  return null;
}

/** One line for a recipe step, enough for a reviewer to see what it does without reading JSON. */
export function describeStep(step: RecipeStep): string {
  switch (step.kind) {
    case "goto":
      return `Go to ${step.url}`;
    case "fill":
      return `Fill ${describeLocator(step.target) ?? "a field"} with ${step.field ?? step.value ?? "a value"}`;
    case "select":
      return `Choose ${step.field ?? step.value ?? "an option"} in ${describeLocator(step.target) ?? "a list"}`;
    case "click":
      return `Click ${describeLocator(step.target) ?? "a control"}`;
    case "check":
      return `${step.checked ? "Tick" : "Untick"} ${describeLocator(step.target) ?? "a box"}`;
    case "press":
      return `Press ${step.key}`;
    case "pause":
      return `Pause ${step.minMs} to ${step.maxMs} ms`;
    case "wait_for":
      return `Wait for ${describeLocator(step.target) ?? "the page"}`;
    case "expect_text":
      return `Expect the text "${step.text}"`;
    case "expect_url":
      return `Expect an address matching ${step.pattern}`;
    case "extract_candidates":
      return "Read the records found";
    case "extract_text":
      return `Read ${step.as.replace("_", " ")} from the page`;
    case "select_record":
      return `${step.action === "click" ? "Click" : "Tick"} the record you confirmed`;
    case "outcome_when":
      return "End with an outcome when the page matches";
    case "captcha_checkpoint":
      return "Stop for a person if a CAPTCHA appears";
    case "email_confirmation":
      return `Wait for a confirmation email from ${step.fromDomain}`;
  }
}

export interface PasswordDraft {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

export const EMPTY_PASSWORD_DRAFT: PasswordDraft = {
  currentPassword: "",
  newPassword: "",
  confirm: "",
};

export function checkPassword(draft: PasswordDraft): Partial<Record<keyof PasswordDraft, string>> {
  const errors: Partial<Record<keyof PasswordDraft, string>> = {};
  if (draft.currentPassword === "") errors.currentPassword = "Enter your current password.";
  if (draft.newPassword.length < MIN_PASSWORD_LENGTH) {
    errors.newPassword = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  } else if (draft.newPassword.length > MAX_PASSWORD_LENGTH) {
    errors.newPassword = `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  } else if (draft.newPassword === draft.currentPassword) {
    errors.newPassword = "Choose a password you have not used here.";
  }
  if (draft.confirm !== draft.newPassword) errors.confirm = "The two passwords do not match.";
  return errors;
}

export interface RetentionField {
  key: keyof RetentionSettings;
  label: string;
  help: string;
  /** Windows offered in the list, in days. The saved value is added if it is not one of these. */
  choices: readonly number[];
}

export const RETENTION_FIELDS: readonly RetentionField[] = [
  {
    key: "screenshotDays",
    label: "Keep screenshots for",
    help: "A worker takes one when a form gets stuck. Each is deleted this long after its task finishes.",
    choices: [7, 14, 30, 90, 180, 365],
  },
  {
    key: "messageDays",
    label: "Keep reply text for",
    help: "The body, preview, and links of replies you have dealt with. The sender, subject, and outcome stay, so a request keeps its history.",
    choices: [30, 90, 180, 365],
  },
];

export const KEEP_FOREVER = "forever";

export type RetentionDraft = Record<keyof RetentionSettings, string>;

export function retentionDraftOf(retention: RetentionSettings): RetentionDraft {
  const text = (days: number | null) => (days === null ? KEEP_FOREVER : String(days));
  return {
    screenshotDays: text(retention.screenshotDays),
    messageDays: text(retention.messageDays),
  };
}

/** The list for one field: its usual windows, plus a saved value set some other way, in order. */
export function retentionChoices(field: RetentionField, saved: number | null): number[] {
  return [...new Set([...field.choices, ...(saved === null ? [] : [saved])])].sort((a, b) => a - b);
}

export function describeDays(days: number): string {
  if (days % 365 === 0) return days === 365 ? "1 year" : `${days / 365} years`;
  return `${days} days`;
}

/** A window that went from keeping forever to a number, or got shorter, deletes data on save. */
export function clearsData(patch: RetentionPatch, saved: RetentionSettings): boolean {
  return RETENTION_FIELDS.some(({ key }) => {
    const next = patch[key];
    if (next === undefined || next === null) return false;
    const before = saved[key];
    return before === null || next < before;
  });
}

/** Only the fields that differ from what is saved, so a save never rewrites one it did not touch. */
export function retentionPatchOf(draft: RetentionDraft, saved: RetentionSettings): RetentionPatch {
  const patch: RetentionPatch = {};
  for (const field of RETENTION_FIELDS) {
    const value = draft[field.key] === KEEP_FOREVER ? null : Number(draft[field.key]);
    if (value !== saved[field.key]) patch[field.key] = value;
  }
  return patch;
}
