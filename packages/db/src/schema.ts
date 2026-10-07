import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const createdAt = () =>
  text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString());

export const profiles = sqliteTable("profiles", {
  id: id(),
  displayName: text("display_name").notNull(),
  state: text("state", { length: 2 }).notNull(),
  createdAt: createdAt(),
});

export const identities = sqliteTable(
  "identities",
  {
    id: id(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["name", "alias", "email", "phone", "address", "dob"],
    }).notNull(),
    value: text("value", { mode: "json" }).notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    createdAt: createdAt(),
  },
  (t) => [index("identities_profile_idx").on(t.profileId)],
);

export const mailboxes = sqliteTable("mailboxes", {
  id: id(),
  profileId: text("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  address: text("address").notNull(),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull(),
  smtpSecure: integer("smtp_secure", { mode: "boolean" }).notNull(),
  imapHost: text("imap_host").notNull(),
  imapPort: integer("imap_port").notNull(),
  username: text("username").notNull(),
  secret: text("secret").notNull(),
  replyFolder: text("reply_folder").notNull().default("INBOX"),
  dailyCap: integer("daily_cap").notNull(),
  lastPollUid: integer("last_poll_uid"),
  lastPolledAt: text("last_polled_at"),
  createdAt: createdAt(),
});

export const targets = sqliteTable(
  "targets",
  {
    id: id(),
    kind: text("kind", { enum: ["broker", "company"] }).notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    domain: text("domain").notNull(),
    website: text("website"),
    privacyEmail: text("privacy_email"),
    optOutUrl: text("opt_out_url"),
    privacyRightsUrl: text("privacy_rights_url"),
    contactMethod: text("contact_method").notNull(),
    region: text("region").notNull(),
    requiresId: integer("requires_id", { mode: "boolean" }).notNull().default(false),
    data: text("data", { mode: "json" }).notNull(),
    datasetVersion: text("dataset_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("targets_kind_domain_idx").on(t.kind, t.domain)],
);

export const recipes = sqliteTable(
  "recipes",
  {
    id: id(),
    targetId: text("target_id")
      .notNull()
      .references(() => targets.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: ["scan", "remove"] }).notNull(),
    version: integer("version").notNull(),
    definition: text("definition", { mode: "json" }).notNull(),
    health: text("health", { enum: ["unknown", "healthy", "broken"] })
      .notNull()
      .default("unknown"),
    lastCheckedAt: text("last_checked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("recipes_target_purpose_version_idx").on(t.targetId, t.purpose, t.version)],
);

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
    right: text("right", { enum: ["opt_out", "delete"] }).notNull(),
    legalBasis: text("legal_basis").notNull(),
    channel: text("channel", { enum: ["email", "form"] }).notNull(),
    status: text("status").notNull(),
    reference: text("reference").notNull(),
    sentAt: text("sent_at"),
    dueAt: text("due_at"),
    followUpAt: text("follow_up_at"),
    createdAt: createdAt(),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("requests_profile_idx").on(t.profileId),
    index("requests_status_idx").on(t.status),
    uniqueIndex("requests_reference_idx").on(t.reference),
  ],
);

export const requestEvents = sqliteTable(
  "request_events",
  {
    id: id(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }),
    createdAt: createdAt(),
  },
  (t) => [index("request_events_request_idx").on(t.requestId)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: id(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    imapUid: integer("imap_uid").notNull(),
    requestId: text("request_id").references(() => requests.id, { onDelete: "set null" }),
    fromAddress: text("from_address").notNull(),
    subject: text("subject").notNull(),
    receivedAt: text("received_at").notNull(),
    classification: text("classification").notNull(),
    confidence: real("confidence").notNull(),
    headers: text("headers", { mode: "json" }).notNull(),
    snippet: text("snippet"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_mailbox_uid_idx").on(t.mailboxId, t.imapUid),
    index("messages_request_idx").on(t.requestId),
  ],
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
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    candidates: text("candidates", { mode: "json" }),
    error: text("error"),
  },
  (t) => [index("scans_profile_idx").on(t.profileId)],
);

export const matches = sqliteTable(
  "matches",
  {
    id: id(),
    scanId: text("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    recordUrl: text("record_url").notNull(),
    fields: text("fields", { mode: "json" }).notNull(),
    decision: text("decision", { enum: ["pending", "mine", "not_mine"] })
      .notNull()
      .default("pending"),
    decidedAt: text("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [index("matches_scan_idx").on(t.scanId), index("matches_decision_idx").on(t.decision)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: id(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    profileId: text("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
    targetId: text("target_id").references(() => targets.id),
    requestId: text("request_id").references(() => requests.id, { onDelete: "set null" }),
    payload: text("payload", { mode: "json" }).notNull(),
    result: text("result", { mode: "json" }),
    blockedReason: text("blocked_reason"),
    screenshotPath: text("screenshot_path"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: text("lease_expires_at"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: text("run_after"),
    createdAt: createdAt(),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("tasks_status_kind_idx").on(t.status, t.kind),
    index("tasks_profile_idx").on(t.profileId),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
