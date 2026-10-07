import type {
  BlockedReason,
  ContactMethod,
  RecipeHealth,
  RecipeStatus,
  ReplyClassification,
  RequestChannel,
  RequestEventType,
  RequestRight,
  Requirement,
  TargetCategory,
  TargetKind,
  TargetPriority,
  TaskKind,
} from "@kickrocks/shared";
import type { Tone } from "./tone.js";

/*
 * Display words for every enum a page shows. They live here so the same value reads the same on
 * every page. Each table is a Record over the enum, so a new value fails to compile until it has
 * words. Copy is plain and short: no exclamation marks, no emoji.
 */

export const TARGET_KIND_LABELS: Record<TargetKind, string> = {
  broker: "Data broker",
  company: "Company",
};

export const TARGET_CATEGORY_LABELS: Record<TargetCategory, string> = {
  "people-search": "People search",
  marketing: "Marketing",
  "background-check": "Background check",
  "financial-b2b": "Financial and B2B",
  "device-id-only": "Device ID only",
  "requires-id": "Requires ID",
  "registered-broker": "Registered broker",
  retail: "Retail",
  finance: "Finance",
  telecom: "Telecom",
  tech: "Technology",
  media: "Media",
  travel: "Travel",
  auto: "Auto",
  health: "Health",
  other: "Other",
};

export const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
  email: "Email",
  form: "Web form",
  both: "Email or web form",
  unknown: "Unknown",
};

export const REQUIREMENT_LABELS: Record<Requirement, string> = {
  email_confirmation: "Email confirmation",
  phone_call: "Phone call",
  id_upload: "ID upload",
  captcha: "CAPTCHA",
  account: "Account",
  paid: "Paid",
  record_url: "Record URL",
  postal_mail: "Postal mail",
  fax: "Fax",
};

export const PRIORITY_LABELS: Record<TargetPriority, string> = {
  crucial: "Crucial",
  high: "High",
  normal: "Normal",
};

export const PRIORITY_TONES: Record<TargetPriority, Tone> = {
  crucial: "violet",
  high: "indigo",
  normal: "neutral",
};

export const RIGHT_LABELS: Record<RequestRight, string> = {
  opt_out: "Opt out of sale",
  delete: "Delete my data",
};

export const CHANNEL_LABELS: Record<RequestChannel, string> = {
  email: "Email",
  form: "Web form",
};

export const BLOCKED_REASON_LABELS: Record<BlockedReason, string> = {
  captcha: "CAPTCHA",
  phone_verification: "Phone verification",
  id_upload: "ID upload",
  email_verification: "Email verification",
  login_required: "Login required",
  bot_detection: "Bot detection",
  recipe_failed: "Recipe failed",
  unknown: "Unknown",
};

export const CLASSIFICATION_LABELS: Record<ReplyClassification, string> = {
  bounce: "Bounce",
  auto_ack: "Automatic reply",
  confirmation_link: "Confirmation link",
  verification_required: "Verification required",
  completed: "Completed",
  no_record: "No record",
  rejected: "Rejected",
  needs_form: "Needs web form",
  unrelated: "Unrelated",
  unknown: "Unknown",
};

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  email_send: "Send email",
  inbox_poll: "Check inbox",
  scan: "Scan for records",
  form: "Submit form",
  confirm: "Confirm by link",
  canary: "Recipe health check",
  agent: "Agent task",
};

export const REQUEST_EVENT_LABELS: Record<RequestEventType, string> = {
  created: "Request created",
  queued: "Queued to send",
  sent: "Email sent",
  send_failed: "Send failed",
  reply_received: "Reply received",
  classified: "Reply classified",
  link_followed: "Confirmation link followed",
  status_changed: "Status changed",
  follow_up_sent: "Follow-up sent",
  channel_switched: "Switched channel",
  task_enqueued: "Task queued",
  task_blocked: "Task blocked",
  task_completed: "Task completed",
  task_failed: "Task failed",
  user_action: "Action by you",
  relisted: "Record relisted",
  note: "Note",
};

export const RECIPE_HEALTH_LABELS: Record<RecipeHealth, string> = {
  unknown: "Not checked",
  healthy: "Healthy",
  broken: "Broken",
};

export const RECIPE_HEALTH_TONES: Record<RecipeHealth, Tone> = {
  unknown: "neutral",
  healthy: "green",
  broken: "red",
};

export const RECIPE_STATUS_LABELS: Record<RecipeStatus, string> = {
  active: "Active",
  pending_review: "Pending review",
  rejected: "Rejected",
  retired: "Retired",
};
