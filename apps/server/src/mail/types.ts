import type {
  MailFolder,
  ProfileField,
  ReplyClassification,
  RequestChannel,
  RequestStatus,
} from "@kickrocks/shared";

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
  /**
   * Where replies should go instead of the sender, set only to a reply address the mailbox proved
   * it receives. From stays the mailbox itself, so the broker sees mail that aligns with it.
   */
  replyTo?: string | undefined;
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
  /**
   * Message-IDs read from the original a delivery report or a quote attaches (`message/rfc822` or
   * `text/rfc822-headers`), which is where a bounce says which mail it is about.
   */
  originalMessageIds: string[];
  /**
   * Verifies the message's DKIM signatures when asked, because doing so costs DNS lookups that
   * most messages never need.
   */
  verifyDkim: DkimCheck;
}

/**
 * A DKIM signature that verified over the whole body and belongs to a domain the check was asked
 * about, with the values of the headers it covers. Each value is raw text with only folding
 * removed, taken from the instance the signature hashed, so a header added above it is not here.
 */
export interface VerifiedSignature {
  domain: string;
  inReplyTo: string[];
  references: string[];
  subject: string[];
}

/** The verified signatures whose d= could align with one of `domains`. Empty when none qualified or verification could not finish. */
export type DkimCheck = (domains: readonly string[]) => Promise<VerifiedSignature[]>;

export interface ScanOptions {
  /**
   * Only messages dated on or after this day (IMAP SINCE). The first poll of a mailbox passes the
   * mailbox's creation time or the oldest outstanding send, so years of old mail are never
   * looked at, and a UIDVALIDITY reset does not bring them back either.
   */
  since: Date | null;
  /** The most messages one call returns, oldest first, so a poll has a bounded cost. */
  limit: number;
}

/**
 * What a message's headers say, which is all the intake gate needs to decide about most mail.
 * Nothing here is the body, so reading it costs a kilobyte or two per message.
 */
export interface MessageHeaders {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: { name: string | null; address: string };
  /** Every address the mail was sent to: To, Cc, Delivered-To and X-Original-To. */
  recipients: string[];
  subject: string;
  date: Date | null;
  /** A delivery status report, a mail from a mailer daemon, or one that names failed recipients. */
  isDeliveryReport: boolean;
  /** Header names are lower case. */
  headers: Record<string, string>;
}

export interface ScanResult {
  /** The folder's current UIDVALIDITY. */
  uidValidity: number;
  /**
   * True when `uidValidity` differed from the value the caller passed. UIDs from before are then
   * meaningless, so the caller stores the new value and reads from `since`.
   */
  reset: boolean;
  messages: MessageHeaders[];
  /** More matching messages wait beyond `limit`, so the caller polls again soon. */
  hasMore: boolean;
  /**
   * The highest UID the folder holds, null when it is empty. When `hasMore` is false the caller
   * stores this as its cursor, so messages that were skipped for being older than `since` are
   * never looked at again. When `hasMore` is true the cursor is the UID of the last message returned.
   */
  highestUid: number | null;
}

/** A server-side search over a folder, used to look for mail a cursor had already passed. */
export interface FolderSearch {
  since: Date;
  /** Only messages dated before this day. */
  until?: Date;
  /** The Message-ID header must be exactly this, which proves a particular mail arrived. */
  messageId?: string;
  /** Sender domains or addresses; a message from any of them matches. */
  from?: string[];
  /** Text that must appear in the message body or headers; any of them matches. */
  text?: string[];
  limit: number;
}

/** One login on one folder. Everything a poll does to a mailbox happens inside one of these. */
export interface InboxSession {
  /** The folder's current UIDVALIDITY, which says whether the UIDs stored earlier still mean anything. */
  uidValidity(): number;
  /** Headers of the messages with a UID above `afterUid` (all when null), oldest first. */
  scan(
    afterUid: number | null,
    uidValidity: number | null,
    options: ScanOptions,
  ): Promise<ScanResult>;
  /** Headers of specific messages, in the folder's current numbering. Messages that are gone are left out. */
  headers(uids: readonly number[]): Promise<MessageHeaders[]>;
  /**
   * Asks the server which of `uids` contain any of `terms` in their body. Null when the server
   * refused or timed out, in which case the caller downloads the messages instead and decides
   * locally, at more cost but with the same outcome.
   */
  searchBodies(uids: readonly number[], terms: readonly string[]): Promise<Set<number> | null>;
  /** UIDs matching a search, newest last. Null when the server cannot search. */
  search(query: FolderSearch): Promise<number[] | null>;
  /** The full messages, parsed. Only called for mail the gate admits or has to read to decide. */
  fetchMessages(uids: readonly number[]): Promise<InboxMessage[]>;
}

export interface InboxSource {
  listFolders(): Promise<MailFolder[]>;
  /** Logs in once, runs `work` on the folder, and logs out. */
  withFolder<T>(folder: string, work: (session: InboxSession) => Promise<T>): Promise<T>;
}

/** An outstanding request a reply might belong to. */
export interface ClassifierRequest {
  id: string;
  /**
   * Whether an answer is still expected or a confirmation awaited. Closed requests stay in the
   * context so a late reply that quotes them still binds, but a sender alone never matches one.
   */
  open: boolean;
  targetKind: "broker" | "company";
  /** The address a request is sent to, which a bounce names as the failed recipient. */
  contactAddress: string | null;
  sentAt: string | null;
  reference: string;
  outgoingMessageId: string | null;
  status: RequestStatus;
  channel: RequestChannel;
  targetId: string;
  targetName: string;
  /** The target's domain; its subdomains count as the same site. */
  targetDomain: string;
  /**
   * Every domain the target's genuine replies may come from, its own included. A company often
   * answers from a parent or a privacy vendor. Used to match a sender to the request and to align
   * DKIM; a reply still needs a signature that binds it to the request.
   */
  replyDomains: string[];
  /**
   * Only the sister domains the dataset curates for the target. A confirmation sender stored with a
   * form wait is trusted by this list and the target's own organization, never by `replyDomains`,
   * which also holds the host of the target's contact mailbox.
   */
  curatedReplyDomains: string[];
  /**
   * Exact sender addresses to trust when the target's privacy mailbox is on a public mail
   * provider, where the domain proves nothing. A signature from that provider's domain then vouches
   * only for a message sent from one of these addresses.
   */
  replyAddresses: string[];
  /** The record a form removal is for, which tells apart several requests to one target. */
  recordUrl: string | null;
  /**
   * Set while a submitted form waits for the broker's confirmation email, which carries no
   * reference of ours and no In-Reply-To. It comes from the recipe's `email_confirmation` step or
   * from `FormResult.confirmationFrom`, and the sender is often a sister site rather than the
   * target's own domain, as when PeopleConnect writes for Intelius.
   *
   * Matching rule: a `confirmation_link` message from one of `fromDomains` belongs to the oldest
   * request (by `since`) that is waiting like this for the same profile and target, unless the
   * message names a record URL, in which case it belongs to the request for that record. Such a
   * match has confidence of at least 0.8, because the sender, the target, and the wait agree.
   * The link follower is given these domains as well as the target's own.
   */
  awaitingConfirmation: {
    fromDomains: string[];
    linkTextPattern: string | null;
    since: string;
  } | null;
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
  /** Links worth following, already limited to the target's own domain and any sender it expects. */
  links: string[];
  /**
   * For `verification_required`, the identifiers the broker asked for, as profile field names. A
   * person approves some of them before anything is sent. Empty for every other classification.
   */
  requestedFields: ProfileField[];
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
  /**
   * Follows a link, re-checking every redirect hop against `allowedDomains`, which are the
   * target's own domain plus any `awaitingConfirmation.fromDomains`. Private and loopback
   * addresses are refused unless their host is in `config.linkFollower.allowedPrivateHosts`.
   */
  follow(url: string, allowedDomains: readonly string[]): Promise<FollowResult>;
}

export interface MailServices {
  transport(connection: MailConnection): MailTransport;
  inbox(connection: MailConnection): InboxSource;
  classifier: ReplyClassifier;
  linkFollower: LinkFollower;
}
