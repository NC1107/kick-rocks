import type {
  AgentReason,
  BlockedReason,
  ContactMethod,
  Difficulty,
  DifficultyReason,
  EmailKind,
  FailureKind,
  FormOutcome,
  IdentityKind,
  MatchDecision,
  ProfileField,
  RecipeHealth,
  RecipeStatus,
  ReplyClassification,
  RequestAction,
  RequestChannel,
  RequestEventType,
  RequestRight,
  Requirement,
  SkipReason,
  TargetCategory,
  TargetKind,
  TargetPriority,
  TaskKind,
} from "@kickrocks/shared";

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

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export const DIFFICULTY_MEANINGS: Record<Difficulty, string> = {
  easy: "Kick Rocks can send this on its own, by email.",
  medium: "Kick Rocks can do this with a recipe it already trusts.",
  hard: "A person or an agent has to do part of this.",
};

export const DIFFICULTY_REASON_LABELS: Record<DifficultyReason, string> = {
  email: "It takes requests at its own privacy email address.",
  no_record_needed: "A request can go out without finding your listing first.",
  form: "It takes requests through a web form.",
  recipe_ready: "An approved recipe covers each step Kick Rocks runs, and none is failing.",
  needs_record: "Your listing has to be found before it can be removed.",
  needs_phone: "It needs a phone call that only you can make.",
  needs_id: "It wants a photo of your ID.",
  needs_payment: "It charges for removal.",
  needs_account: "You have to create an account first.",
  captcha: "It shows a CAPTCHA that only you can solve.",
  needs_mail: "It only accepts requests by post.",
  needs_fax: "It only accepts requests by fax.",
  no_recipe: "No approved recipe fills in its form, so an agent or you have to.",
  recipe_broken: "Its approved recipe is failing against the live site.",
  email_shared:
    "Its only address is on a shared mail host such as gmail.com, which proves nothing about who replies.",
  no_contact: "There is no usable email address or opt-out page on file.",
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
  sent: "Sent",
  send_failed: "Send failed",
  reply_received: "Reply received",
  classified: "Reply classified",
  link_followed: "Confirmation link followed",
  status_changed: "Status changed",
  follow_up_sent: "Follow-up sent",
  channel_switched: "Switched channel",
  awaiting_confirmation: "Waiting for confirmation email",
  task_enqueued: "Task queued",
  task_blocked: "Task blocked",
  task_completed: "Task completed",
  task_failed: "Task failed",
  task_cancelled: "Task cancelled",
  task_resumed: "Task resumed",
  task_retrying: "Task retrying",
  user_action: "Action by you",
  relisted: "Record relisted",
  note: "Note",
};

export const RECIPE_HEALTH_LABELS: Record<RecipeHealth, string> = {
  unknown: "Not checked",
  healthy: "Healthy",
  broken: "Broken",
};

export const RECIPE_STATUS_LABELS: Record<RecipeStatus, string> = {
  active: "Active",
  pending_review: "Pending review",
  rejected: "Rejected",
  retired: "Retired",
};

export const IDENTITY_KIND_LABELS: Record<IdentityKind, string> = {
  name: "Name",
  alias: "Alias",
  email: "Email",
  phone: "Phone",
  address: "Address",
  dob: "Date of birth",
};

export const PROFILE_FIELD_LABELS: Record<ProfileField, string> = {
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name",
  email: "Email address",
  phone: "Phone number",
  city: "City",
  state: "State",
  zip: "ZIP code",
  street: "Street address",
  birth_year: "Year of birth",
  date_of_birth: "Date of birth",
  record_url: "Record link",
};

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  already_active: "Already in progress",
  no_contact_method: "No way to contact them",
  scan_in_progress: "Scan already running",
  no_mailbox: "No mailbox connected",
  already_confirmed: "Already removed",
  unsupported_channel: "Needs mail, fax, or a call",
  missing_profile_details: "Needs more profile details",
  covered_by_platform: "Covered by a state platform",
};

export const REQUEST_ACTION_LABELS: Record<RequestAction, string> = {
  cancel: "Cancel request",
  resend: "Send again",
  mark_confirmed: "Mark as confirmed",
  mark_rejected: "Mark as rejected",
  mark_no_record: "Mark as no record",
};

export const MATCH_DECISION_LABELS: Record<MatchDecision, string> = {
  pending: "Waiting for you",
  mine: "This is me",
  not_mine: "Not me",
};

export const EMAIL_KIND_LABELS: Record<EmailKind, string> = {
  initial: "Request",
  follow_up: "Follow-up",
  verification_reply: "Verification reply",
};

export const FORM_OUTCOME_LABELS: Record<FormOutcome, string> = {
  submitted: "Submitted the form",
  not_found: "No record found",
  already_removed: "Already removed",
  awaiting_email_confirmation: "Waiting for a confirmation email",
};

export const FAILURE_KIND_LABELS: Record<FailureKind, string> = {
  recipe: "The saved steps no longer match the page",
  site: "The site had a problem",
  network: "The connection dropped",
  internal: "Something went wrong here",
};

export const AGENT_REASON_LABELS: Record<AgentReason, string> = {
  no_recipe: "No saved steps for this site",
  recipe_failed: "The saved steps stopped working",
  blocked: "Handed over after a human check",
};
