import type { MailFolder, ReplyClassification, RequestStatus } from "@kickrocks/shared";

/** Everything needed to reach one mailbox over SMTP and IMAP. */
export interface MailConnection {
  address: string;
  username: string;
  /** The app password. */
  password: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
}

export interface VerifyResult {
  ok: boolean;
  error: string | null;
}

export interface OutgoingMail {
  from: { name: string | null; address: string };
  to: string;
  subject: string;
  /** Plain text only, and no tracking. */
  text: string;
  /** Built by `outgoingMessageId` so a reply can be matched without a lookup. */
  messageId: string;
  inReplyTo?: string | undefined;
  references?: string[] | undefined;
}

export interface SendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

export interface MailTransport {
  verify(): Promise<VerifyResult>;
  send(mail: OutgoingMail): Promise<SendResult>;
}

export interface InboxMessage {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: { name: string | null; address: string };
  to: string[];
  subject: string;
  date: Date | null;
  text: string;
  html: string | null;
  /** A delivery status report or a mail from a mailer daemon. */
  isBounce: boolean;
  /** The `Auto-Submitted` header says a machine sent it. */
  autoSubmitted: boolean;
  /** Header names are lower case. */
  headers: Record<string, string>;
}

export interface FetchResult {
  /** The folder's current UIDVALIDITY. */
  uidValidity: number;
  /**
   * True when `uidValidity` differed from the value the caller passed. UIDs from before are then
   * meaningless, so every message is returned and the caller stores the new value.
   */
  reset: boolean;
  messages: InboxMessage[];
}

export interface InboxSource {
  listFolders(): Promise<MailFolder[]>;
  /** Messages in a folder with a UID above `afterUid`; every message when `afterUid` is null. */
  fetchSince(
    folder: string,
    afterUid: number | null,
    uidValidity: number | null,
  ): Promise<FetchResult>;
}

/** An outstanding request a reply might belong to. */
export interface ClassifierRequest {
  id: string;
  reference: string;
  outgoingMessageId: string | null;
  status: RequestStatus;
  targetId: string;
  targetName: string;
  /** The target's domain; its subdomains count as the same site. */
  targetDomain: string;
}

export interface ClassifyContext {
  requests: ClassifierRequest[];
}

export interface ClassificationResult {
  /** The request this reply belongs to, or null when it could not be matched. */
  requestId: string | null;
  correlation: "message_id" | "reference" | "sender_domain" | null;
  classification: ReplyClassification;
  /** 0 to 1. Below 0.6 the message goes to a person unless an LLM is configured. */
  confidence: number;
  rationale: string;
  /** Links worth following, already limited to the target's own domain. */
  links: string[];
}

export interface ReplyClassifier {
  classify(message: InboxMessage, context: ClassifyContext): Promise<ClassificationResult>;
}

export interface FollowResult {
  ok: boolean;
  finalUrl: string | null;
  status: number | null;
  /** The page needs JavaScript or a button press, so a browser must finish the job. */
  needsBrowser: boolean;
  reason: string | null;
}

export interface LinkFollower {
  /** Follows a link, re-checking every redirect hop against `allowedDomains`. */
  follow(url: string, allowedDomains: readonly string[]): Promise<FollowResult>;
}

export interface MailServices {
  transport(connection: MailConnection): MailTransport;
  inbox(connection: MailConnection): InboxSource;
  classifier: ReplyClassifier;
  linkFollower: LinkFollower;
}
