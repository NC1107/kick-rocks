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

export interface FetchOptions {
  /**
   * Only messages dated on or after this day (IMAP SINCE). The first poll of a mailbox passes the
   * mailbox's creation time or the oldest outstanding send, so years of old mail are never
   * downloaded and classified, and a UIDVALIDITY reset does not bring them back either.
   */
  since: Date | null;
  /** The most messages one call returns, oldest first, so a poll has a bounded cost. */
  limit: number;
}

export interface FetchResult {
  /** The folder's current UIDVALIDITY. */
  uidValidity: number;
  /**
   * True when `uidValidity` differed from the value the caller passed. UIDs from before are then
   * meaningless, so the caller stores the new value and reads from `since`.
   */
  reset: boolean;
  messages: InboxMessage[];
  /** More matching messages wait beyond `limit`, so the caller polls again soon. */
  hasMore: boolean;
  /**
   * The highest UID the folder holds, null when it is empty. When `hasMore` is false the caller
   * stores this as its cursor, so messages that were skipped for being older than `since` are
   * never fetched again. When `hasMore` is true the cursor is the UID of the last message returned.
   */
  highestUid: number | null;
}

export interface InboxSource {
  listFolders(): Promise<MailFolder[]>;
  /**
   * Messages in a folder with a UID above `afterUid` (every message when null), dated on or after
   * `options.since`, oldest first, at most `options.limit`.
   */
  fetchSince(
    folder: string,
    afterUid: number | null,
    uidValidity: number | null,
    options: FetchOptions,
  ): Promise<FetchResult>;
}

/** An outstanding request a reply might belong to. */
export interface ClassifierRequest {
  id: string;
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
