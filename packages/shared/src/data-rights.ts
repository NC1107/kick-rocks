import { z } from "zod";
import { StateCode } from "./geography.js";
import { Identity, ProfileField } from "./identities.js";
import { ReplyClassification } from "./mail.js";
import { RequestChannel, RequestEvent, RequestRight, RequestStatus } from "./requests.js";
import { MatchDecision, MatchFields } from "./scans.js";
import { TargetKind } from "./targets.js";
import { Candidate } from "./tasks.js";
import { WebUrl } from "./url.js";

export const PROFILE_EXPORT_FORMAT = "kickrocks-profile-export";
export const PROFILE_EXPORT_VERSION = 1;

const iso = z.iso.datetime();

/** The mailbox connection without its password, which never leaves the database. */
const ExportedMailbox = z.object({
  provider: z.string(),
  address: z.string(),
  username: z.string(),
  smtpHost: z.string(),
  smtpPort: z.number().int(),
  smtpSecure: z.boolean(),
  imapHost: z.string(),
  imapPort: z.number().int(),
  replyFolder: z.string(),
  dailyCap: z.number().int(),
  createdAt: iso,
});

const ExportedRequest = z.object({
  id: z.string(),
  reference: z.string(),
  target: z.object({ id: z.string(), name: z.string(), domain: z.string(), kind: TargetKind }),
  rights: z.array(RequestRight),
  legalBasis: z.string(),
  channel: RequestChannel,
  status: RequestStatus,
  recordUrl: z.string().nullable(),
  followUps: z.number().int(),
  sentAt: iso.nullable(),
  dueAt: iso.nullable(),
  followUpAt: iso.nullable(),
  lastError: z.string().nullable(),
  createdAt: iso,
  updatedAt: iso,
  /** The timeline, oldest first. */
  events: z.array(RequestEvent),
});

/** Who wrote, when, and how it was classified. The body, snippet, and links stay out. */
const ExportedMessage = z.object({
  id: z.string(),
  requestId: z.string().nullable(),
  fromAddress: z.string(),
  subject: z.string(),
  receivedAt: iso,
  classification: ReplyClassification,
  confidence: z.number(),
  requestedFields: z.array(ProfileField),
  reviewed: z.boolean(),
});

const ExportedScan = z.object({
  id: z.string(),
  targetId: z.string(),
  targetName: z.string(),
  startedAt: iso,
  finishedAt: iso.nullable(),
  error: z.string().nullable(),
  candidates: z.array(Candidate).nullable(),
});

const ExportedMatch = z.object({
  id: z.string(),
  scanId: z.string(),
  targetId: z.string(),
  recordUrl: WebUrl,
  fields: MatchFields,
  decision: MatchDecision,
  decidedAt: iso.nullable(),
  requestId: z.string().nullable(),
});

/** Everything Kick Rocks holds about one profile, as one file the person can keep. */
export const ProfileExport = z.object({
  format: z.literal(PROFILE_EXPORT_FORMAT),
  version: z.literal(PROFILE_EXPORT_VERSION),
  exportedAt: iso,
  profile: z.object({
    id: z.string(),
    displayName: z.string(),
    state: StateCode,
    createdAt: iso,
    updatedAt: iso,
  }),
  identities: z.array(Identity),
  mailbox: ExportedMailbox.nullable(),
  requests: z.array(ExportedRequest),
  messages: z.array(ExportedMessage),
  scans: z.array(ExportedScan),
  matches: z.array(ExportedMatch),
});
export type ProfileExport = z.infer<typeof ProfileExport>;

/** What a person types to confirm wiping the instance. */
export const RESET_CONFIRMATION = "delete everything";

export const ResetBody = z.object({
  confirm: z.literal(RESET_CONFIRMATION, {
    error: `Type "${RESET_CONFIRMATION}" to confirm`,
  }),
});
export type ResetBody = z.infer<typeof ResetBody>;
