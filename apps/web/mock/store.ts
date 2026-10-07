import type {
  Match,
  NotificationSettings,
  ProfileDetail,
  RecipeRecord,
  RequestEvent,
  RequestListItem,
  ReviewMessage,
  ScanSummary,
  SettingsView,
  TargetDetail,
  TaskSummary,
} from "@kickrocks/shared";

/** A request as stored: the list row plus its timeline. The detail view adds messages and tasks. */
export type StoredRequest = RequestListItem & { events: RequestEvent[] };

/** What a blocked task shows a person beyond the task row itself. */
export interface BlockedTaskInfo {
  url: string | null;
  manualInstructions: string;
}

/** Notification settings and delivery status. The saved tokens never reach a response. */
export interface MockNotifications {
  settings: NotificationSettings;
  lastSentAt: string | null;
  lastError: string | null;
  digestLastSentAt: string | null;
  digestLastError: string | null;
}

export function freshMockNotifications(): MockNotifications {
  return {
    settings: {
      ntfy: null,
      telegram: null,
      categories: ["blocked_task", "verification", "match", "mailbox", "recipe"],
      maxPerHour: 6,
      digest: { frequency: "off", hourUtc: 8, weekday: 1 },
    },
    lastSentAt: null,
    lastError: null,
    digestLastSentAt: null,
    digestLastError: null,
  };
}

export type MockAuthMode = "authed" | "login" | "setup";

export interface MockAuthState {
  setupRequired: boolean;
  authenticated: boolean;
  /** The mock instance password. Null until setup runs. */
  password: string | null;
  failedLogins: number;
}

export const MOCK_PASSWORD = "kickrocks-mock";

/**
 * Every collection the domains share. It is plain in-memory data: a page owner adds a collection
 * here only when two domains need it; data one domain owns can live in its own module.
 */
export interface MockStore {
  /** Fixture time, so relative dates such as "3 days ago" stay stable across a session. */
  readonly clock: { now(): Date };
  auth: MockAuthState;
  profiles: ProfileDetail[];
  targets: TargetDetail[];
  requests: StoredRequest[];
  messages: ReviewMessage[];
  tasks: TaskSummary[];
  blockedInfo: Map<string, BlockedTaskInfo>;
  matches: Match[];
  scans: ScanSummary[];
  recipes: RecipeRecord[];
  settings: SettingsView;
  /** The last MCP token minted, kept only so the mock can say a token is set. */
  mcpToken: string | null;
  notifications: MockNotifications;
  /** A short unique id such as "req_0007". */
  nextId(prefix: string): string;
  /** A float in [0, 1) from a fixed seed, so fixtures do not change between restarts. */
  random(): number;
  /** An ISO time offset from now: ago({ days: 2, hours: 3 }). */
  ago(offset: { days?: number; hours?: number; minutes?: number }): string;
  /** An ISO time in the future, for due dates. */
  ahead(offset: { days?: number; hours?: number; minutes?: number }): string;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function offsetMs(offset: { days?: number; hours?: number; minutes?: number }): number {
  return (offset.days ?? 0) * DAY + (offset.hours ?? 0) * HOUR + (offset.minutes ?? 0) * MINUTE;
}

export function createStore(authMode: MockAuthMode = "authed"): MockStore {
  const startedAt = Date.now();
  const counters = new Map<string, number>();
  const random = mulberry32(20261007);
  const clock = { now: () => new Date() };

  return {
    clock,
    auth: {
      setupRequired: authMode === "setup",
      authenticated: authMode === "authed",
      password: authMode === "setup" ? null : MOCK_PASSWORD,
      failedLogins: 0,
    },
    profiles: [],
    targets: [],
    requests: [],
    messages: [],
    tasks: [],
    blockedInfo: new Map(),
    matches: [],
    scans: [],
    recipes: [],
    settings: {
      schedule: {
        pollMinutes: 15,
        peopleSearchRescanDays: 60,
        brokerRescanDays: 90,
        noResponseDays: 45,
        maxFollowUps: 2,
      },
      llm: null,
      retention: { messageDays: null, screenshotDays: 30 },
      mcp: { enabled: false, tokenSet: false, url: "http://localhost:8420/mcp" },
      siteChecks: { enabled: false },
      worker: { enabled: false, status: null },
    },
    mcpToken: null,
    notifications: freshMockNotifications(),
    nextId(prefix) {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${String(next).padStart(4, "0")}`;
    },
    random,
    ago(offset) {
      return new Date(startedAt - offsetMs(offset)).toISOString();
    },
    ahead(offset) {
      return new Date(startedAt + offsetMs(offset)).toISOString();
    },
  };
}
