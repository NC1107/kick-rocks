import type { MailFolder } from "@kickrocks/shared";
import type { Clock } from "../core/clock.js";
import type {
  ClassificationResult,
  ClassifyContext,
  FetchOptions,
  FetchResult,
  FollowResult,
  InboxMessage,
  LinkFollower,
  MailConnection,
  MailServices,
  OutgoingMail,
  ReplyClassifier,
  VerifyResult,
} from "../mail/types.js";

export interface SentMail {
  connection: MailConnection;
  mail: OutgoingMail;
}

export type DeliverableMessage = Partial<InboxMessage> & { folder?: string };

export interface FakeMailbox {
  /** The folders `listFolders` reports. Replace the array to change them. */
  folders: MailFolder[];
  uidValidity: number;
  /** Simulates the server renumbering the folder: every message stays, under a new uid. */
  resetUidValidity(next?: number): void;
  /** Puts a message in a folder, filling in anything the test does not care about. */
  deliver(message?: DeliverableMessage): InboxMessage;
}

export type ClassifyHandler = (
  message: InboxMessage,
  context: ClassifyContext,
) => Partial<ClassificationResult> | null;

export interface ProgrammableClassifier extends ReplyClassifier {
  calls: Array<{ message: InboxMessage; context: ClassifyContext }>;
  /** Newest handler first. A handler returns null to let an older one answer. */
  program(handler: ClassifyHandler): void;
  /** Answers messages whose subject matches. */
  when(subject: string | RegExp, result: Partial<ClassificationResult>): void;
  reset(): void;
}

export type FollowHandler = (
  url: string,
  allowedDomains: readonly string[],
) => Partial<FollowResult> | null;

export interface ProgrammableLinkFollower extends LinkFollower {
  calls: Array<{ url: string; allowedDomains: readonly string[] }>;
  program(handler: FollowHandler): void;
  reset(): void;
}

export interface FakeMail {
  services: MailServices;
  /** Every message handed to a transport, oldest first. */
  sent: SentMail[];
  /** What `verify` answers. */
  verifyResult: VerifyResult;
  /** Makes the next `send` throw. */
  failNextSend(error?: Error): void;
  mailbox(address: string): FakeMailbox;
  classifier: ProgrammableClassifier;
  linkFollower: ProgrammableLinkFollower;
}

const UNMATCHED: ClassificationResult = {
  requestId: null,
  correlation: null,
  classification: "unknown",
  confidence: 0,
  rationale: "No fake classifier handler matched",
  links: [],
  requestedFields: [],
};

function createClassifier(): ProgrammableClassifier {
  let handlers: ClassifyHandler[] = [];
  const classifier: ProgrammableClassifier = {
    calls: [],
    program(handler) {
      handlers = [handler, ...handlers];
    },
    when(subject, result) {
      classifier.program((message) =>
        (
          typeof subject === "string"
            ? message.subject.includes(subject)
            : subject.test(message.subject)
        )
          ? result
          : null,
      );
    },
    reset() {
      handlers = [];
      classifier.calls = [];
    },
    async classify(message, context) {
      classifier.calls.push({ message, context });
      for (const handler of handlers) {
        const answer = handler(message, context);
        if (answer) return { ...UNMATCHED, ...answer };
      }
      return UNMATCHED;
    },
  };
  return classifier;
}

function createLinkFollower(): ProgrammableLinkFollower {
  let handlers: FollowHandler[] = [];
  const follower: ProgrammableLinkFollower = {
    calls: [],
    program(handler) {
      handlers = [handler, ...handlers];
    },
    reset() {
      handlers = [];
      follower.calls = [];
    },
    async follow(url, allowedDomains) {
      follower.calls.push({ url, allowedDomains });
      const base: FollowResult = {
        ok: true,
        finalUrl: url,
        status: 200,
        needsBrowser: false,
        reason: null,
      };
      for (const handler of handlers) {
        const answer = handler(url, allowedDomains);
        if (answer) return { ...base, ...answer };
      }
      return base;
    },
  };
  return follower;
}

const RENUMBER_OFFSET = 1000;

class ScriptedMailbox implements FakeMailbox {
  folders: MailFolder[] = [
    { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
    { path: "Junk", name: "Junk", specialUse: "\\Junk" },
  ];
  uidValidity = 1;
  private readonly byFolder = new Map<string, InboxMessage[]>();
  private nextUid = new Map<string, number>();

  constructor(
    readonly address: string,
    private readonly clock: Clock,
  ) {}

  resetUidValidity(next = this.uidValidity + 1): void {
    this.uidValidity = next;
    for (const [folder, held] of this.byFolder) {
      this.byFolder.set(
        folder,
        held.map((message) => ({ ...message, uid: message.uid + RENUMBER_OFFSET })),
      );
      this.nextUid.set(folder, (this.nextUid.get(folder) ?? 1) + RENUMBER_OFFSET);
    }
  }

  deliver({ folder = "INBOX", ...overrides }: DeliverableMessage = {}): InboxMessage {
    const uid = overrides.uid ?? this.nextUid.get(folder) ?? 1;
    this.nextUid.set(folder, Math.max(uid + 1, this.nextUid.get(folder) ?? 1));
    const message: InboxMessage = {
      uid,
      messageId: `<fake-${folder}-${uid}@mail.test>`,
      inReplyTo: null,
      references: [],
      from: { name: null, address: "privacy@broker.test" },
      to: [this.address],
      subject: "Re: your request",
      date: this.clock.now(),
      text: "",
      html: null,
      isBounce: false,
      autoSubmitted: false,
      headers: {},
      dkimDomains: [],
      ...overrides,
    };
    this.byFolder.set(folder, [...(this.byFolder.get(folder) ?? []), message]);
    return message;
  }

  fetchSince(
    folder: string,
    afterUid: number | null,
    uidValidity: number | null,
    { since, limit }: FetchOptions = { since: null, limit: Number.POSITIVE_INFINITY },
  ): FetchResult {
    const reset = uidValidity !== null && uidValidity !== this.uidValidity;
    const floor = reset ? 0 : (afterUid ?? 0);
    const inFolder = (this.byFolder.get(folder) ?? []).sort((a, b) => a.uid - b.uid);
    const matching = inFolder.filter(
      (message) =>
        message.uid > floor &&
        (since === null || message.date === null || message.date.getTime() >= since.getTime()),
    );
    const messages = matching.slice(0, limit);
    return {
      uidValidity: this.uidValidity,
      reset,
      messages,
      hasMore: matching.length > messages.length,
      highestUid:
        inFolder.length === 0 ? null : (inFolder[inFolder.length - 1] as InboxMessage).uid,
    };
  }
}

/** Mail services that record what is sent and serve whatever a test delivers. Nothing leaves the process. */
export function createFakeMail(clock: Clock): FakeMail {
  const mailboxes = new Map<string, ScriptedMailbox>();
  const mailboxFor = (address: string) => {
    let mailbox = mailboxes.get(address);
    if (!mailbox) {
      mailbox = new ScriptedMailbox(address, clock);
      mailboxes.set(address, mailbox);
    }
    return mailbox;
  };

  let failure: Error | null = null;
  const classifier = createClassifier();
  const linkFollower = createLinkFollower();

  const fake: FakeMail = {
    sent: [],
    verifyResult: { ok: true, error: null },
    failNextSend(error = new Error("The fake transport was told to fail")) {
      failure = error;
    },
    mailbox: mailboxFor,
    classifier,
    linkFollower,
    services: {
      transport: (connection) => ({
        verify: async () => fake.verifyResult,
        send: async (mail) => {
          if (failure) {
            const error = failure;
            failure = null;
            throw error;
          }
          fake.sent.push({ connection, mail });
          return { messageId: mail.messageId, accepted: [mail.to], rejected: [] };
        },
      }),
      inbox: (connection) => {
        const mailbox = mailboxFor(connection.address);
        return {
          listFolders: async () => mailbox.folders,
          fetchSince: async (folder, afterUid, uidValidity, options) =>
            mailbox.fetchSince(folder, afterUid, uidValidity, options),
        };
      },
      classifier,
      linkFollower,
    },
  };
  return fake;
}
