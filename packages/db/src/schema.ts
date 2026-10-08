import {
  BlockedReason,
  BreakerState,
  type Broker,
  type CampaignSelection,
  type Candidate,
  ClaimerKind,
  type Company,
  ContactMethod,
  EmailKind,
  FailureKind,
  type Identity,
  IdentityKind,
  LIVE_TASK_STATUSES,
  MatchDecision,
  type MatchFields,
  type ProfileField,
  PushbackKind,
  type Recipe,
  RecipeHealth,
  RecipePurpose,
  RecipeSource,
  RecipeStatus,
  ReplyClassification,
  RequestActor,
  RequestChannel,
  type RequestEventPayloads,
  RequestEventType,
  type RequestRight,
  RequestStatus,
  type Requirement,
  SettingKey,
  StateCode,
  TargetCategory,
  TargetKind,
  type TargetOutcome,
  TargetPriority,
  TaskKind,
  TaskStatus,
  type TaskUsage,
} from "@kickrocks/shared";
import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/*
 * Timestamps are ISO-8601 strings in UTC. They have no database default on purpose: every
 * writer takes the time from the injected clock, so a test with a fake clock stays consistent.
 */
const id = () => text("id").primaryKey();

/** Drizzle wants a non-empty tuple; every zod enum used here has at least one member. */
const values = <T extends string>(options: readonly T[]) => options as [T, ...T[]];
const timestamp = (name: string) => text(name);

export const profiles = sqliteTable("profiles", {
  id: id(),
  displayName: text("display_name").notNull(),
  state: text("state", { enum: values(StateCode.options) }).notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const identities = sqliteTable(
  "identities",
  {
    id: id(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: values(IdentityKind.options) }).notNull(),
    value: text("value", { mode: "json" }).$type<Identity["value"]>().notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
  },
  (t) => [index("identities_profile_idx").on(t.profileId)],
);

export const mailboxes = sqliteTable(
  "mailboxes",
  {
    id: id(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    address: text("address").notNull(),
    username: text("username").notNull(),
    /** The app password. The whole file is encrypted, so this is not hashed or wrapped again. */
    secret: text("secret").notNull(),
    smtpHost: text("smtp_host").notNull(),
    smtpPort: integer("smtp_port").notNull(),
    smtpSecure: integer("smtp_secure", { mode: "boolean" }).notNull(),
    imapHost: text("imap_host").notNull(),
    imapPort: integer("imap_port").notNull(),
    replyFolder: text("reply_folder").notNull().default("INBOX"),
    dailyCap: integer("daily_cap").notNull(),
    uidValidity: integer("uid_validity"),
    lastPollUid: integer("last_poll_uid"),
    lastPolledAt: timestamp("last_polled_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [uniqueIndex("mailboxes_profile_idx").on(t.profileId)],
);

export const targets = sqliteTable(
  "targets",
  {
    id: id(),
    kind: text("kind", { enum: values(TargetKind.options) }).notNull(),
    name: text("name").notNull(),
    category: text("category", { enum: values(TargetCategory.options) }).notNull(),
    domain: text("domain").notNull(),
    website: text("website"),
    privacyEmail: text("privacy_email"),
    optOutUrl: text("opt_out_url"),
    privacyRightsUrl: text("privacy_rights_url"),
    searchUrl: text("search_url"),
    contactMethod: text("contact_method", { enum: values(ContactMethod.options) }).notNull(),
    region: text("region", { enum: ["us", "eu", "global"] }).notNull(),
    requiresId: integer("requires_id", { mode: "boolean" }).notNull().default(false),
    requirements: text("requirements", { mode: "json" }).$type<Requirement[]>().notNull(),
    priority: text("priority", { enum: values(TargetPriority.options) }).notNull(),
    /** The full dataset record this row was built from. */
    data: text("data", { mode: "json" }).$type<Broker | Company>().notNull(),
    datasetVersion: text("dataset_version").notNull(),
    /** Set when a dataset update no longer lists the target; the row stays so history keeps its meaning. */
    retired: integer("retired", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [
    // A target that left the dataset is retired, and its domain may then belong to a new id.
    uniqueIndex("targets_kind_domain_idx").on(t.kind, t.domain).where(sql`${t.retired} = 0`),
  ],
);

export const recipes = sqliteTable(
  "recipes",
  {
    /** `<brokerId>.<purpose>.v<version>`, the same as the recipe's own id. */
    id: id(),
    targetId: text("target_id")
      .notNull()
      .references(() => targets.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: values(RecipePurpose.options) }).notNull(),
    version: integer("version").notNull(),
    definition: text("definition", { mode: "json" }).$type<Recipe>().notNull(),
    source: text("source", { enum: values(RecipeSource.options) }).notNull(),
    status: text("status", { enum: values(RecipeStatus.options) }).notNull(),
    health: text("health", { enum: values(RecipeHealth.options) })
      .notNull()
      .default("unknown"),
    failureCount: integer("failure_count").notNull().default(0),
    lastCheckedAt: timestamp("last_checked_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("recipes_target_purpose_version_idx").on(t.targetId, t.purpose, t.version),
    index("recipes_target_status_idx").on(t.targetId, t.purpose, t.status),
  ],
);

export const campaigns = sqliteTable("campaigns", {
  id: id(),
  profileId: text("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  rights: text("rights", { mode: "json" }).$type<RequestRight[]>().notNull(),
  selection: text("selection", { mode: "json" }).$type<CampaignSelection>().notNull(),
  createdCount: integer("created_count").notNull(),
  skipped: text("skipped", { mode: "json" }).$type<TargetOutcome[]>().notNull(),
  createdAt: timestamp("created_at").notNull(),
});

export const requests = sqliteTable(
  "requests",
  {
    id: id(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    targetId: text("target_id")
      .notNull()
      .references(() => targets.id),
    campaignId: text("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    mailboxId: text("mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),
    rights: text("rights", { mode: "json" }).$type<RequestRight[]>().notNull(),
    legalBasis: text("legal_basis").notNull(),
    channel: text("channel", { enum: values(RequestChannel.options) }).notNull(),
    status: text("status", { enum: values(RequestStatus.options) }).notNull(),
    /** `KR-XXXXXX`, put in every subject so a reply can be matched. */
    reference: text("reference").notNull(),
    outgoingMessageId: text("outgoing_message_id"),
    recordUrl: text("record_url"),
    followUps: integer("follow_ups").notNull().default(0),
    sentAt: timestamp("sent_at"),
    dueAt: timestamp("due_at"),
    followUpAt: timestamp("follow_up_at"),
    /** Set while a submitted form waits for the broker's confirmation email; only valid in awaiting_reply. */
    awaitingConfirmationSince: timestamp("awaiting_confirmation_since"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("requests_reference_idx").on(t.reference),
    index("requests_profile_status_idx").on(t.profileId, t.status),
    index("requests_target_idx").on(t.targetId),
    index("requests_outgoing_message_idx").on(t.outgoingMessageId),
  ],
);

export const requestEvents = sqliteTable(
  "request_events",
  {
    id: id(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    type: text("type", { enum: values(RequestEventType.options) }).notNull(),
    actor: text("actor", { enum: values(RequestActor.options) }).notNull(),
    /** Validated against the schema for `type` before it is written, and again when it is read. */
    payload: text("payload", { mode: "json" })
      .$type<RequestEventPayloads[RequestEventType]>()
      .notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [index("request_events_request_idx").on(t.requestId, t.createdAt)],
);

/**
 * Every message the email runner sent. It is the one source for "how many in the last 24 hours" and
 * "when was the last one", so the daily cap, the pacing, and the dashboard cannot count differently.
 */
export const outgoingMail = sqliteTable(
  "outgoing_mail",
  {
    id: id(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: values(EmailKind.options) }).notNull(),
    messageId: text("message_id").notNull(),
    sentAt: timestamp("sent_at").notNull(),
  },
  (t) => [
    index("outgoing_mail_mailbox_sent_idx").on(t.mailboxId, t.sentAt),
    index("outgoing_mail_request_idx").on(t.requestId),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: id(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    imapUid: integer("imap_uid").notNull(),
    uidValidity: integer("uid_validity").notNull(),
    requestId: text("request_id").references(() => requests.id, { onDelete: "set null" }),
    messageIdHeader: text("message_id_header"),
    inReplyTo: text("in_reply_to"),
    fromAddress: text("from_address").notNull(),
    subject: text("subject").notNull(),
    receivedAt: timestamp("received_at").notNull(),
    classification: text("classification", { enum: values(ReplyClassification.options) }).notNull(),
    confidence: real("confidence").notNull(),
    rationale: text("rationale"),
    links: text("links", { mode: "json" }).$type<string[]>().notNull(),
    /** For a verification request, the identifiers the broker asked for. Field names only. */
    requestedFields: text("requested_fields", { mode: "json" })
      .$type<ProfileField[]>()
      .notNull()
      .default(sql`'[]'`),
    snippet: text("snippet"),
    /** The message text, cut to MESSAGE_TEXT_MAX_CHARS, for a person classifying it by hand. */
    text: text("text"),
    /** A person looked at it, or it needed no look. Unreviewed low-confidence mail fills the review queue. */
    reviewed: integer("reviewed", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("messages_mailbox_uid_idx").on(t.mailboxId, t.uidValidity, t.imapUid),
    index("messages_request_idx").on(t.requestId),
    index("messages_review_idx").on(t.reviewed, t.classification),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: id(),
    kind: text("kind", { enum: values(TaskKind.options) }).notNull(),
    status: text("status", { enum: values(TaskStatus.options) })
      .notNull()
      .default("queued"),
    /** Higher runs first. */
    priority: integer("priority").notNull().default(0),
    profileId: text("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
    targetId: text("target_id").references(() => targets.id),
    requestId: text("request_id").references(() => requests.id, { onDelete: "cascade" }),
    /** Ids only; personal data is resolved from the profile when the task is claimed. */
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    result: text("result", { mode: "json" }).$type<unknown>(),
    blockedReason: text("blocked_reason", { enum: values(BlockedReason.options) }),
    blockedDetail: text("blocked_detail"),
    /** The page where the worker got stuck, shown to the person who finishes the job by hand. */
    blockedUrl: text("blocked_url"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    /**
     * The worker said a removal run has clicked, so the form may already be submitted. A task in
     * this state is never retried: losing its lease holds it for a person.
     */
    mayHaveSubmitted: integer("may_have_submitted", { mode: "boolean" }).notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    runAfter: timestamp("run_after"),
    dedupeKey: text("dedupe_key"),
    lastError: text("last_error"),
    failureKind: text("failure_kind", { enum: values(FailureKind.options) }),
    failureStep: integer("failure_step"),
    /** The worker that last ended its lease on the task. */
    finishedBy: text("finished_by"),
    /** Who claimed it: the built-in worker, an MCP client, or a model. Set by the claiming route. */
    claimerKind: text("claimer_kind", { enum: values(ClaimerKind.options) }),
    /** What the attempts cost, summed. */
    usage: text("usage", { mode: "json" }).$type<TaskUsage>(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [
    index("tasks_claim_idx").on(t.status, t.kind, t.priority),
    index("tasks_profile_idx").on(t.profileId),
    index("tasks_request_idx").on(t.requestId),
    // Only live tasks hold a key, so a finished task never blocks the next run of the same work.
    uniqueIndex("tasks_dedupe_live_idx")
      .on(t.dedupeKey)
      .where(sql`${t.status} in (${sql.raw(LIVE_TASK_STATUSES.map((s) => `'${s}'`).join(", "))})`),
  ],
);

export const taskArtifacts = sqliteTable(
  "task_artifacts",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["screenshot"] }).notNull(),
    mime: text("mime").notNull(),
    /** Stored in the database rather than on disk so screenshots are encrypted at rest. */
    data: blob("data", { mode: "buffer" }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [index("task_artifacts_task_idx").on(t.taskId)],
);

export const scans = sqliteTable(
  "scans",
  {
    id: id(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    targetId: text("target_id")
      .notNull()
      .references(() => targets.id),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at"),
    candidates: text("candidates", { mode: "json" }).$type<Candidate[]>(),
    error: text("error"),
    /**
     * A hash of who was searched for and where, so a later scan for the same identity on the same
     * site can reuse this result. Null for scans from before the key existed.
     */
    searchKey: text("search_key"),
    /** The scan whose result this one copied instead of searching, so a copy never extends reuse. */
    reusedFromScanId: text("reused_from_scan_id"),
  },
  (t) => [
    index("scans_profile_idx").on(t.profileId),
    index("scans_task_idx").on(t.taskId),
    index("scans_search_key_idx").on(t.searchKey),
  ],
);

/**
 * Every browser task start, keyed by the owner of the site it visited. The daily cap, the hourly
 * cap, and the one-at-a-time rule all read from here, so they cannot count differently.
 */
export const siteVisits = sqliteTable(
  "site_visits",
  {
    id: id(),
    domain: text("domain").notNull(),
    /** Null for a request the server made itself, such as following a confirmation link. */
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at").notNull(),
    /** The visit was the single cautious probe after a circuit breaker's cooldown. */
    probe: integer("probe", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("site_visits_domain_started_idx").on(t.domain, t.startedAt),
    index("site_visits_started_idx").on(t.startedAt),
    index("site_visits_task_idx").on(t.taskId),
  ],
);

/** What Kick Rocks remembers about how a site has treated it. One row per owner domain. */
export const siteState = sqliteTable("site_state", {
  domain: text("domain").primaryKey(),
  /** The earliest the next task may start, after the gap and its jitter. */
  nextStartAfter: timestamp("next_start_after"),
  consecutivePushback: integer("consecutive_pushback").notNull().default(0),
  lastPushbackAt: timestamp("last_pushback_at"),
  lastPushbackKind: text("last_pushback_kind", { enum: values(PushbackKind.options) }),
  coolingDownUntil: timestamp("cooling_down_until"),
  breaker: text("breaker", { enum: values(BreakerState.options) })
    .notNull()
    .default("closed"),
  /** The Crawl-delay the site's robots.txt sets, in seconds. */
  crawlDelaySeconds: real("crawl_delay_seconds"),
  updatedAt: timestamp("updated_at").notNull(),
});

export const matches = sqliteTable(
  "matches",
  {
    id: id(),
    scanId: text("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    targetId: text("target_id")
      .notNull()
      .references(() => targets.id),
    recordUrl: text("record_url").notNull(),
    fields: text("fields", { mode: "json" }).$type<MatchFields>().notNull(),
    decision: text("decision", { enum: values(MatchDecision.options) })
      .notNull()
      .default("pending"),
    decidedAt: timestamp("decided_at"),
    requestId: text("request_id").references(() => requests.id, { onDelete: "set null" }),
  },
  (t) => [
    index("matches_scan_idx").on(t.scanId),
    index("matches_profile_decision_idx").on(t.profileId, t.decision),
    index("matches_record_idx").on(t.profileId, t.targetId, t.recordUrl),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** The sha256 of the cookie token; the token itself is never stored. */
    id: id(),
    createdAt: timestamp("created_at").notNull(),
    lastSeenAt: timestamp("last_seen_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_expires_idx").on(t.expiresAt)],
);

export const settings = sqliteTable("settings", {
  key: text("key", { enum: values(SettingKey.options) }).primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export type ProfileRow = typeof profiles.$inferSelect;
export type IdentityRow = typeof identities.$inferSelect;
export type MailboxRow = typeof mailboxes.$inferSelect;
export type TargetRow = typeof targets.$inferSelect;
export type RecipeRow = typeof recipes.$inferSelect;
export type CampaignRow = typeof campaigns.$inferSelect;
export type RequestRow = typeof requests.$inferSelect;
export type RequestEventRow = typeof requestEvents.$inferSelect;
export type OutgoingMailRow = typeof outgoingMail.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type TaskArtifactRow = typeof taskArtifacts.$inferSelect;
export type ScanRow = typeof scans.$inferSelect;
export type SiteVisitRow = typeof siteVisits.$inferSelect;
export type SiteStateRow = typeof siteState.$inferSelect;
export type MatchRow = typeof matches.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type SettingRow = typeof settings.$inferSelect;
